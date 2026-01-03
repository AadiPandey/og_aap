const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    //Use this when you want to test locally 
    callbackURL: "/auth/google/callback" 
    //Use this when you want to deploy for production 
    // callbackURL: process.env.GOOGLE_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value;
    if (email.endsWith("@goa.bits-pilani.ac.in")) {
        return done(null, profile);
    } else {
        return done(null, false, { message: "Unauthorized domain" });
    }
}));

passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

module.exports = passport;
