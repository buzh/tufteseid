/// <reference path="../pb_data/types.d.ts" />
//
// The closed beta, enforced. `1700002000_closed_beta.js` has the collections
// and `docs/closed-beta.md` the SQL for opening slots and granting invites.
//
// None of this could be an API rule: a rule cannot count a reader's invites
// or decrement a counter.
//
// Registrations and nothing else. Every handler runs in a runtime of its own
// and cannot see this file's scope, so each one requires what it needs — see
// `closed_beta.js`, which is where the logic lives and why.

// Registration. Every account comes into being through the record-create API
// on `users`, so this one hook covers all of them.
//
// The transaction is what keeps a refusal from leaking a free place: the
// counter is spent before `e.next()` writes the row, and a throw from either
// rolls both back. Reassigning `e.app` is what makes the inner handlers write
// through the same transaction.
onRecordCreateRequest((e) => {
  // An administrator adding somebody by hand is not a registration.
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const beta = require(`${__hooks}/closed_beta.js`);

  // `requestInfo()`, not `e.request`, which a record event does not carry
  // however much the types suggest otherwise — only a route event does. The
  // keys are snake-cased by `inflector.Snakecase`, the same normalization
  // behind `@request.headers.*` in a collection rule, so `X-Invite-Code`
  // arrives as `x_invite_code`.
  const code = e.requestInfo().headers['x_invite_code'] || '';

  const outerApp = e.app;
  try {
    e.app.runInTransaction((txApp) => {
      e.app = txApp;
      const invite = beta.admit(txApp, code);
      e.next();
      if (invite) {
        // Only now does the account have an id.
        invite.set('redeemedBy', e.record.id);
        txApp.save(invite);
      }
    });
  } finally {
    e.app = outerApp;
  }
}, 'users');

// Minting an invite. The create rule has already established that the reader
// is signed in and is the issuer; what it cannot say is how many they have
// left.
onRecordCreateRequest((e) => {
  const beta = require(`${__hooks}/closed_beta.js`);
  const outerApp = e.app;
  try {
    e.app.runInTransaction((txApp) => {
      e.app = txApp;
      beta.prepareMint(txApp, e.record, e.auth);
      e.next();
    });
  } finally {
    e.app = outerApp;
  }
}, 'invites');

// Sending an invite. A route of its own rather than an update rule, because
// the reader may set the address but nothing else, and because the row is
// only marked sent once the mail is actually away.
//
// One mail per invite, and `users.inviteQuota` letters per account however
// many times its invites are revoked and minted again. A reader who mistyped
// the address revokes the invite, mints another and sends that — at the cost
// of one letter from the budget.
routerAdd(
  'POST',
  '/api/invites/{id}/send',
  (e) => {
    const beta = require(`${__hooks}/closed_beta.js`);

    const body = new DynamicModel({ email: '' });
    e.bindBody(body);

    const email = String(body.email || '').trim();
    // Shape is the `EmailField`'s to judge, below, so that what SMTP is handed
    // is exactly what the row will hold. Empty is this one's: the field is not
    // required, so '' would save.
    if (!email) throw new BadRequestError('Ugyldig e-postadresse.');

    let invite;
    try {
      invite = e.app.findRecordById(beta.INVITES, e.request.pathValue('id'));
    } catch (_) {
      throw new NotFoundError();
    }

    if (invite.getString('issuer') !== e.auth.id) throw new ForbiddenError();
    if (invite.getString('redeemedAt') !== '') {
      throw new BadRequestError('Invitasjonen er allerede brukt.');
    }
    if (invite.getString('sentAt') !== '') {
      throw new BadRequestError('Invitasjonen er allerede sendt.');
    }

    // Judged by the `EmailField` itself rather than by a second rule here,
    // which would disagree with it sooner or later, and judged before the
    // mail rather than after: an address the row will not hold must not be
    // one a letter has already gone to. `validate` writes nothing, so only
    // the save below can fail on anything but the address, and that is a 500.
    invite.set('email', email);
    try {
      e.app.validate(invite);
    } catch (_) {
      throw new BadRequestError('Ugyldig e-postadresse.');
    }
    e.app.save(invite);

    if (!beta.spendMailBudget(e.app, e.auth.id)) {
      throw new ForbiddenError('Du har ikke flere e-poster igjen.', {
        email: new ValidationError(
          'mail_budget_spent',
          'The account has sent as many invite mails as its quota allows.',
        ),
      });
    }

    try {
      e.app.newMailClient().send(beta.inviteMail(e.app, invite, e.auth));
    } catch (err) {
      beta.refundMailBudget(e.app, e.auth.id);
      e.app
        .logger()
        .error('invite mail failed', 'error', String(err), 'invite', invite.id);
      // 502 rather than 500: the installation's SMTP settings are the usual
      // cause, and the invite is still good to pass on by hand.
      throw new ApiError(502, 'Fikk ikke sendt invitasjonen.', {
        email: new ValidationError(
          'mail_failed',
          'The mail could not be sent; check the SMTP settings.',
        ),
      });
    }

    invite.set('sentAt', new DateTime());
    e.app.save(invite);

    return e.json(200, { sent: true });
  },
  $apis.requireAuth(),
);
