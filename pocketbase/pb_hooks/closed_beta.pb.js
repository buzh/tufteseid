/// <reference path="../pb_data/types.d.ts" />
//
// The closed beta, enforced. `1700002000_closed_beta.js` has the collections
// and `docs/closed-beta.md` the SQL for opening slots and granting invites.
//
// None of this could be an API rule: a rule cannot count a reader's invites
// or decrement a counter.

const GATE = 'registration';
const INVITES = 'invites';

// Crockford base32, the alphabet `spots.code` already uses: no I, L, O or U,
// so a code read off a screen or over the phone cannot be mistyped into a
// different valid one.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/** Crockford's own substitutions, so a reader who typed what they saw gets
 *  in. U is not among them — it is excluded from the alphabet rather than
 *  folded onto V, so a code carrying one is simply wrong. */
const normalizeCode = (raw) =>
  String(raw || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

const gateRecord = (app) => {
  const rows = app.findAllRecords(GATE);
  if (!rows || rows.length === 0) {
    throw new InternalServerError('The registration gate row is missing.');
  }
  return rows[0];
};

/**
 * Decides whether an account may be created and spends whatever pays for it.
 * Returns the invite that was drawn on, or null when a free place covered it.
 * Throws a 403 carrying a code the sign-in box branches on.
 *
 * The two ways in are independent. Free places are for whoever walks up to
 * the page; an invite is a way in of its own and does not look at them, so
 * handing out fifty codes is handing out fifty possible accounts whatever the
 * counter says. That arithmetic is the administrator's to do.
 */
const admit = (app, rawCode) => {
  const gate = gateRecord(app);
  if (!gate.getBool('closed')) return null;

  const code = normalizeCode(rawCode);

  if (code) {
    let invite;
    try {
      invite = app.findFirstRecordByFilter(
        INVITES,
        'code = {:code} && redeemedAt = ""',
        { code },
      );
    } catch (_) {
      // Refused rather than fallen back on the free places: silently
      // admitting on a mistyped code leaves the reader thinking it worked,
      // and spends a place they did not ask for.
      throw new ForbiddenError('Invitasjonskoden gjelder ikke.', {
        invite: new ValidationError(
          'invite_invalid',
          'Unknown or already redeemed invite code.',
        ),
      });
    }

    invite.set('redeemedAt', new DateTime());
    app.save(invite);
    return invite;
  }

  const left = gate.getInt('openSlots');
  if (left <= 0) {
    throw new ForbiddenError('Registreringen er stengt.', {
      invite: new ValidationError(
        'registration_closed',
        'No free places left; an invite code is required.',
      ),
    });
  }

  gate.set('openSlots', left - 1);
  app.save(gate);
  return null;
};

// Registration. PocketBase creates the `users` row through its own record-
// create API during the OAuth2 round trip, carrying the browser's headers
// onto the internal request — so this one hook covers every way an account
// can come into being, the identity provider's included.
//
// The OAuth2 path is already inside a transaction, and `runInTransaction`
// reuses a live one rather than opening a second: a second would block
// forever, the write pool being a single connection. Reassigning `e.app` is
// what makes it see the live one. The wrapper earns its place on the paths
// that arrive outside a transaction, where a refusal after the row was
// written would leak a slot.
onRecordCreateRequest((e) => {
  // An administrator adding somebody by hand is not a registration.
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const outerApp = e.app;
  try {
    e.app.runInTransaction((txApp) => {
      e.app = txApp;
      const invite = admit(txApp, e.request.header.get('X-Invite-Code'));
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
// left, which is their quota less the rows they hold.
onRecordCreateRequest((e) => {
  const outerApp = e.app;
  try {
    e.app.runInTransaction((txApp) => {
      e.app = txApp;
      const issuer = e.record.getString('issuer');
      const quota = e.auth ? e.auth.getInt('inviteQuota') : 0;
      const issued = txApp.countRecords(INVITES, $dbx.hashExp({ issuer }));
      if (issued >= quota) {
        throw new ForbiddenError('Du har ingen invitasjoner igjen.', {
          issuer: new ValidationError(
            'invite_quota_spent',
            'The invite quota is used up.',
          ),
        });
      }

      // The client sends nothing but `issuer`. 32^8 ≈ 1.1e12 codes, so a
      // collision against the unique index is not worth a redraw.
      e.record.set(
        'code',
        $security.randomStringWithAlphabet(CODE_LENGTH, ALPHABET),
      );
      e.record.set('redeemedBy', '');
      e.record.set('redeemedAt', '');
      e.record.set('email', '');
      e.record.set('sentAt', '');

      e.next();
    });
  } finally {
    e.app = outerApp;
  }
}, 'invites');

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Bokmål here rather than through `t()`: the mail is composed on the server,
// where the app's locale files do not reach, and letting the client post the
// wording would turn this into a relay for whatever it liked.
const inviteMail = (app, invite, from) => {
  const meta = app.settings().meta;
  const site = meta.appName || 'Tufteseid';
  const code = invite.getString('code');
  const link = `${String(meta.appURL).replace(/\/+$/, '')}/?invite=${code}`;
  const who = String(from.getString('name') || from.getString('email')).trim();

  const text = [
    `${who} har invitert deg til ${site}.`,
    '',
    `Invitasjonskoden din er ${code}.`,
    '',
    `Åpne ${link} og logg inn, så er du med.`,
  ].join('\n');

  return new MailerMessage({
    from: { address: meta.senderAddress, name: meta.senderName },
    to: [{ address: invite.getString('email') }],
    subject: `Du er invitert til ${site}`,
    text,
    html: [
      `<p>${escapeHtml(who)} har invitert deg til ${escapeHtml(site)}.</p>`,
      `<p>Invitasjonskoden din er <strong>${escapeHtml(code)}</strong>.</p>`,
      `<p><a href="${escapeHtml(link)}">Åpne ${escapeHtml(site)}</a> og logg inn, så er du med.</p>`,
    ].join('\n'),
  });
};

// Sending an invite. A route of its own rather than an update rule, because
// the reader may set the address but nothing else, and because the row is
// only marked sent once the mail is actually away.
//
// One mail per invite, so the quota an administrator grants is also the mail
// budget. A reader who mistyped the address revokes the invite, which gives
// the quota back, and mints another.
routerAdd(
  'POST',
  '/api/invites/{id}/send',
  (e) => {
    const body = new DynamicModel({ email: '' });
    e.bindBody(body);

    const email = String(body.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestError('Ugyldig e-postadresse.');
    }

    let invite;
    try {
      invite = e.app.findRecordById(INVITES, e.request.pathValue('id'));
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

    invite.set('email', email);

    try {
      e.app.newMailClient().send(inviteMail(e.app, invite, e.auth));
    } catch (err) {
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
