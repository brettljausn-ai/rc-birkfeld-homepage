const passport = require('passport');

const BASE_URL = process.env.BASE_URL || 'https://lightslategrey-reindeer-921478.hostingersite.com';

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: BASE_URL + '/club/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  const FacebookStrategy = require('passport-facebook').Strategy;
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: BASE_URL + '/club/auth/facebook/callback',
    profileFields: ['id', 'displayName', 'email'],
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
}

module.exports = passport;
