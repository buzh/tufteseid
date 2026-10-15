/// <reference path="../pb_data/types.d.ts" />

const ADMIN = 'admin';

const holds = (user, feature) => {
  if (!user) return false;
  if (user.getString('role') === ADMIN) return true;

  const granted = user.getStringSlice('features');
  for (let i = 0; i < granted.length; i++) {
    if (granted[i] === feature) return true;
  }
  return false;
};

module.exports = {
  holds,
};
