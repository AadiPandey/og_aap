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
    return res.status(500).send(`
      <div class="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div class="bg-red-900/70 border border-red-700 rounded-xl p-6 max-w-md text-center shadow-lg">
          <div class="flex items-center justify-center mb-4">
            <svg class="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 9v2m0 4h.01M12 5a7 7 0 100 14a7 7 0 000-14z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold mb-2">Registration Failed</h2>
          <p class="text-gray-300 mb-4">
            This could be because you have already registered for the course.
          </p>
          <a href="/dashboard" 
            class="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition">
            Back to Dashboard
          </a>
        </div>
      </div>
    `);
  }

  res.redirect('/dashboard');
});

module.exports = router;
