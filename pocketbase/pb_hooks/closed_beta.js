/// <reference path="../pb_data/types.d.ts" />
//
// Everything the closed beta's handlers need, in a module they require rather
// than at the top of the `.pb.js` file beside them.
//
// PocketBase serializes each handler and runs it in a runtime of its own, so
// a handler cannot see the scope of the file it was written in: a constant or
// a helper declared next to it is simply not there. The only symptom is a
// `ReferenceError` in the admin UI's log — nothing fails at load, and the API
// answers a bare 400 with no field named. Globals (`$app`, `$dbx`,
// `MailerMessage`, the error classes) are injected into every runtime and are
// the exception.
//
// Not named `*.pb.js`: that suffix is what PocketBase loads as hooks, and
// this file registers none.

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

/** Null on an installation whose single row is missing, which reads as no
 *  gate at all — the same thing `src/api/invites.ts` tells the sign-in box, so
 *  the two ends cannot disagree about whether registration is open. A read
 *  that fails rather than coming back empty still throws. */
const gateRecord = (app) => {
  const rows = app.findAllRecords(GATE);
  return rows && rows.length > 0 ? rows[0] : null;
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
  if (!gate || !gate.getBool('closed')) return null;

  const code = normalizeCode(rawCode);

  if (code) {
    // Listed rather than `findFirstRecordByFilter`, which throws the same way
    // on a code nobody holds and on a database that would not answer: an
    // empty list is the first, and anything thrown here is the second and
    // deserves a 500 rather than being read back as a typo.
    const found = app.findRecordsByFilter(
      INVITES,
      'code = {:code} && redeemedAt = ""',
      '',
      1,
      0,
      { code },
    );

    if (found.length === 0) {
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

/**
 * Fills in everything on a new invite that is not the client's to send, once
 * the reader is known to have one left to mint. What the create rule cannot
 * say is how many that is: their quota less the rows they hold.
 */
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

  // The client sends nothing but `issuer`. 32^8 ≈ 1.1e12 codes, so a
  // collision against the unique index is not worth a redraw.
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

/**
 * Reserves one letter against `users.invitesSent`, answering whether there
 * was one left. False means the budget is spent.
 *
 * A counter of its own rather than the mint quota, which cannot double as a
 * mail budget: revoking refunds it, so mint → send → revoke → mint would post
 * as many letters as the sender liked, to addresses of their choosing, from
 * the installation's own sender. This one only ever goes up.
 *
 * Read and written in a transaction of its own, outside the mail: two sends
 * racing would otherwise both see the same count, and holding the single
 * write connection open across SMTP would block every other writer.
 */
const spendMailBudget = (app, userId) => {
  let spent = false;
  app.runInTransaction((txApp) => {
    const user = txApp.findRecordById('users', userId);
    const sent = user.getInt('invitesSent');
    if (sent >= user.getInt('inviteQuota')) return;
    user.set('invitesSent', sent + 1);
    txApp.save(user);
    spent = true;
  });
  return spent;
};

/** For a letter SMTP refused outright, which is the installation's fault
 *  rather than the sender's. */
const refundMailBudget = (app, userId) => {
  app.runInTransaction((txApp) => {
    const user = txApp.findRecordById('users', userId);
    const sent = user.getInt('invitesSent');
    if (sent <= 0) return;
    user.set('invitesSent', sent - 1);
    txApp.save(user);
  });
};

module.exports = {
  INVITES,
  admit,
  prepareMint,
  inviteMail,
  spendMailBudget,
  refundMailBudget,
};
