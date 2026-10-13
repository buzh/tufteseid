/// <reference path="../pb_data/types.d.ts" />

routerAdd(
  'POST',
  '/api/profile/email',
  (e) => {
    const body = new DynamicModel({ email: '', password: '' });
    e.bindBody(body);

    const email = String(body.email || '').trim();


    if (!email) throw new BadRequestError('Ugyldig e-postadresse.');


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


      e.auth.setVerified(false);



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
