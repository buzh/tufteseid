/// <reference path="../pb_data/types.d.ts" />

const GATE = 'registration';
const INVITES = 'invites';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

const normalizeCode = (raw) =>
  String(raw || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

const gateRecord = (app) => {
  const rows = app.findAllRecords(GATE);
  return rows && rows.length > 0 ? rows[0] : null;
};

const admit = (app, rawCode) => {
  const gate = gateRecord(app);
  if (!gate || !gate.getBool('closed')) return null;

  const code = normalizeCode(rawCode);

  if (code) {
    const found = app.findRecordsByFilter(
      INVITES,
      'code = {:code} && redeemedAt = ""',
      '',
      1,
      0,
      { code },
    );

    if (found.length === 0) {
      throw new ForbiddenError('Invitasjonskoden gjelder ikke.', {
        invite: new ValidationError(
          'invite_invalid',
          'Unknown or already redeemed invite code.',
        ),
      });
    }

    const invite = found[0];
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

const prepareMint = (app, record, auth) => {
  const issuer = record.getString('issuer');
  const quota = auth ? auth.getInt('inviteQuota') : 0;
  const issued = app.countRecords(INVITES, $dbx.hashExp({ issuer }));
  if (issued >= quota) {
    throw new ForbiddenError('Du har ingen invitasjoner igjen.', {
      issuer: new ValidationError(
        'invite_quota_spent',
        'The invite quota is used up.',
      ),
    });
  }

  record.set('code', $security.randomStringWithAlphabet(CODE_LENGTH, ALPHABET));
  record.set('redeemedBy', '');
  record.set('redeemedAt', '');
  record.set('email', '');
  record.set('sentAt', '');
};

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

module.exports = {
  INVITES,
  admit,
  prepareMint,
  inviteMail,
};
