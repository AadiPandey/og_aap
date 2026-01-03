const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const supabaseAdmin = require('../supabaseAdmin');

router.get('/', async (req, res) => {
  const userId = String(req.user.id);

  const { data: users, error: userError } = await supabaseAdmin
    .from('users')
    .select('google_id, email, display_name, phone_number')
    .eq('google_id', userId);

  if (userError) {
    console.error('Error fetching user record:', userError);
    return res.status(500).send('Error loading user record');
  }

  let userRecord = users && users.length > 0 ? users[0] : null;

  if (!userRecord) {
    await supabaseAdmin.from('users').insert([{
      google_id: userId,
      email: req.user.email,
      display_name: req.user.displayName,
      phone_number: null
    }]);
    return res.redirect('/dashboard/enter-phone');
  }

  const hasPhone = userRecord.phone_number !== null && userRecord.phone_number !== undefined && userRecord.phone_number.trim() !== '';
  if (!hasPhone) {
    return res.redirect('/dashboard/enter-phone');
  }

  const { data: courses, error: courseError } = await supabaseAdmin.from('cte_courses').select('*');
  const { data: registrations, error: regError } = await supabaseAdmin
    .from('course_registrations')
    .select('course_id')
    .eq('user_id', userId);

  if (courseError || regError) {
    console.error('Error loading dashboard:', courseError || regError);
    return res.status(500).send('Error loading dashboard');
  }

  const registeredIds = new Set(registrations.map(r => r.course_id));

  const userEmail = req.user?.email || req.user?.emails?.[0]?.value;
  let isAdmin = false;
  if (userEmail) {
    const { data: admins } = await supabaseAdmin
      .from('admins')
      .select('email')
      .eq('email', userEmail);

    if (admins && admins.length > 0) {
      isAdmin = true;
    }
  }

  res.render('dashboard', {
    courses: courses || [],
    registeredIds,
    user: req.user,
    isAdmin
  });
});

router.get('/enter-phone', (req, res) => {
  res.render('enter_phone', { user: req.user });
});

router.post('/enter-phone', async (req, res) => {
  const { phone_number } = req.body;
  const userId = String(req.user.id);
  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(phone_number)) {
    return res.status(400).send('Invalid phone number format');
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ phone_number })
    .eq('google_id', userId);

  if (error) {
    console.error('Error saving phone number:', error);
    return res.status(500).send('Could not save phone number');
  }

  res.redirect('/dashboard');
});

router.post('/register/:courseId', async (req, res) => {
  const userId = req.user.id;
  const courseId = req.params.courseId;

  // Fetch display_name from users table
  const { data: userData, error: userFetchError } = await supabaseAdmin
    .from('users')
    .select('display_name')
    .eq('google_id', userId)
    .single();

  if (userFetchError) {
    console.error('Error fetching user display_name:', userFetchError);
    return res.status(500).send('Could not fetch user info');
  }

  const displayName = userData?.display_name || req.user.displayName || '';

  const { error } = await supabase
    .from('course_registrations')
    .insert([{
      user_id: userId,
      course_id: courseId,
      display_name: displayName   // ✅ new column populated
    }]);

  if (error) {
    console.error('Registration error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Registration Failed</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div class="bg-red-900/70 border border-red-700 rounded-xl p-6 max-w-md w-full text-center shadow-lg">
          <div class="flex items-center justify-center mb-4">
            <svg class="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 9v2m0 4h.01M12 5a7 7 0 100 14a7 7 0 000-14z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold mb-2">Registration Failed</h2>
          <p class="text-gray-300 mb-4">
            You may have already registered for this course. Please return to the dashboard to verify.
          </p>
          <a href="/dashboard" 
            class="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition">
            Back to Dashboard
          </a>
        </div>
      </body>
      </html>
    `);
  }

  res.redirect('/dashboard');
});

module.exports = router;
