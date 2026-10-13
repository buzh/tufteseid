/// <reference path="../pb_data/types.d.ts" />

onRecordCreateRequest((e) => {

  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const beta = require(`${__hooks}/closed_beta.js`);






  const code = e.requestInfo().headers['x_invite_code'] || '';

  const outerApp = e.app;
  try {
    e.app.runInTransaction((txApp) => {
      e.app = txApp;
      const invite = beta.admit(txApp, code);
      e.next();
      if (invite) {

        invite.set('redeemedBy', e.record.id);
        txApp.save(invite);
      }
    });
  } finally {
    e.app = outerApp;
  }
}, 'users');

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

routerAdd(
  'POST',
  '/api/invites/{id}/send',
  (e) => {
    const beta = require(`${__hooks}/closed_beta.js`);

    const body = new DynamicModel({ email: '' });
    e.bindBody(body);

    const email = String(body.email || '').trim();



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






    invite.set('email', email);
    try {
      e.app.validate(invite);
    } catch (_) {
      throw new BadRequestError('Ugyldig e-postadresse.');
    }
    e.app.save(invite);

    try {
      e.app.newMailClient().send(beta.inviteMail(e.app, invite, e.auth));
    } catch (err) {
      e.app
        .logger()
        .error('invite mail failed', 'error', String(err), 'invite', invite.id);


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
