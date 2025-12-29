const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

router.get('/', async (req, res) => {
  const userId = req.user.id;

  const { data: courses, error: courseError } = await supabase
    .from('cte_courses')
    .select('*');

  const { data: registrations, error: regError } = await supabase
    .from('course_registrations')
    .select('course_id')
    .eq('user_id', userId);

  if (courseError || regError) {
    console.error('Error loading dashboard:', courseError || regError);
    return res.status(500).send('Error loading dashboard');
  }

  const registeredIds = new Set(registrations.map(r => r.course_id));

  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim());
  const userEmail = req.user?.email || req.user?.emails?.[0]?.value;
  const isAdmin = adminEmails?.includes(userEmail);
  console.log('Admin check:', userEmail, isAdmin);

  res.render('dashboard', {
    courses: courses || [],
    registeredIds,
    user: req.user,
    isAdmin 
  });
});



router.post('/register/:courseId', async (req, res) => {
  const userId = req.user.id; 
  const courseId = req.params.courseId;

  const { error } = await supabase
    .from('course_registrations')
    .insert([{ user_id: userId, course_id: courseId }]);

  if (error) {
    console.error('Registration error:', error);
    return res.status(500).send('Registration failed');
  }

  res.redirect('/dashboard');
});

module.exports = router;
