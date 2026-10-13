/// <reference path="../pb_data/types.d.ts" />

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const capacity = require(`${__hooks}/capacity.js`);

  e.record.set('role', capacity.roleForNewUser(e.app));
  e.record.set('features', []);
  e.record.set('inviteQuota', 0);

  e.next();
}, 'users');

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const stored = e.record.original();
  ['role', 'features', 'inviteQuota'].forEach((field) => {
    e.record.set(field, stored.get(field));
  });

  e.next();
}, 'users');
