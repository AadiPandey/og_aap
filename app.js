require('dotenv').config();
const express = require('express');
const app = express();
const session = require('express-session');
const passport = require('./passport');
const path = require('path');
const supabaseAdmin = require('./supabaseAdmin');
const dashboardRoutes = require('./routes/dashboard');
const adminRouter = require('./routes/admin');
const techWeekendRouter = require('./routes/techWeekend');

app.use(express.static(path.join(process.cwd(), 'public')));

app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/catalog', async (req, res) => {
  try {
    const { data: courses, error } = await supabaseAdmin
      .from('cte_courses')
      .select('*');

    if (error) {
      console.error('Error fetching courses:', error);
      return res.status(500).send('Error loading courses');
    }

    res.render('catalog', {
      courses: courses || [],
      user: req.user || null
    });
  } catch (err) {
    console.error('Unexpected error loading catalog:', err);
    res.status(500).send('Error loading catalog');
  }
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/auth/google', (req, res, next) => {
  const state = req.query.techweekend === 'true' ? 'techweekend' : 'courses';
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state
  })(req, res, next);
});

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/unauthorized' }),
  async (req, res) => {
    const { id, displayName, emails } = req.user;
    const email = emails?.[0]?.value || null;

    const state = req.query.state;

    try {
      if (state === 'techweekend') {
        const { error } = await supabaseAdmin
          .from('tw_users')
          .upsert({
            google_id: id,
            email,
            display_name: displayName,
          });
        if (error) {
          console.error('Supabase TechWeekend upsert failed:', error);
          return res.redirect('/unauthorized');
        }
        return res.redirect('/tech-weekend');
      } else {
        const { error } = await supabaseAdmin
          .from('users')
          .upsert({
            google_id: id,
            email,
            display_name: displayName,
          });
        if (error) {
          console.error('Supabase user upsert failed:', error);
          return res.redirect('/unauthorized');
        }
        return res.redirect('/dashboard');
      }
    } catch (err) {
      console.error('Unexpected error during upsert:', err);
      return res.redirect('/unauthorized');
    }
  }
);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

app.use('/dashboard', ensureAuthenticated, dashboardRoutes);
app.use('/tech-weekend', ensureAuthenticated, techWeekendRouter);

const isAdmin = require('./middleware/isAdmin');

app.use('/admin', isAdmin, adminRouter);
app.use('/admin/techweekend', isAdmin, require('./routes/techWeekendAdmin'));

app.get('/unauthorized', (req, res) => {
  res.send("Access restricted to BITS Goa users only.");
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.adminVerified = false;
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
