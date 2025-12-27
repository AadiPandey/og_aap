require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('./passport');
const path = require('path');

const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(express.static(path.join(process.cwd(), 'public')));

app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
  res.render('index');
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/unauthorized' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

app.use('/dashboard', ensureAuthenticated, dashboardRoutes);

app.get('/unauthorized', (req, res) => {
  res.send("Access restricted to BITS Goa users only.");
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = app;
