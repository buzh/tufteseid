/// <reference path="../pb_data/types.d.ts" />
//
// Moving the address an account is reached at, with no letter in it.
//
// A route of its own because PocketBase will not take `email` on a
// self-PATCH: the upsert form pins the field to its stored value for anything
// short of manage access, and the one way it offers instead —
// `requestEmailChange` and a confirmation link — is the verification step
// this installation does not run yet (`docs/identity.md`).
//
// The password stands in for that letter. With nothing to confirm, the
// address is the whole of account recovery, so a borrowed tab must not be
// able to move it: PocketBase demands `oldPassword` before a password change
// and this asks the same before an address change. Setting `manageRule` would
// have let the SPA PATCH the address directly, but it also drops that
// `oldPassword` requirement — the very guard this route exists to keep.

routerAdd(
  'POST',
  '/api/profile/email',
  (e) => {
    const body = new DynamicModel({ email: '', password: '' });
    e.bindBody(body);

    const email = String(body.email || '').trim();
    // Shape and uniqueness are the field's to judge, below. Empty is this
    // one's: `setEmail('')` on an auth record is a 500 waiting to happen.
    if (!email) throw new BadRequestError('Ugyldig e-postadresse.');

    // bcrypt, so the comparison is slow by design and throttles guessing.
    if (!e.auth.validatePassword(String(body.password || ''))) {
      throw new ApiError(400, 'Feil passord.', {
        password: new ValidationError(
          'wrong_password',
          'The current password does not match.',
        ),
      });
    }

    if (email !== e.auth.email()) {
      e.auth.setEmail(email);
      // Honest rather than load-bearing: nothing reads `verified` yet, the
      // auth rule being empty (`1700002500_password_auth.js`).
      e.auth.setVerified(false);

      // The token key is deliberately left alone, so the session survives.
      // It is the password that signs a token, and that has not moved.
      try {
        e.app.save(e.auth);
      } catch (_) {
        throw new ApiError(
          400,
          'E-postadressen er ugyldig eller allerede i bruk.',
          {
            email: new ValidationError(
              'email_unavailable',
              'The address is not one this collection will take.',
            ),
          },
        );
      }
    }

    return e.json(200, { email: e.auth.email() });
  },
  $apis.requireAuth('users'),
);
