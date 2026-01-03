const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const supabaseAdmin = require('../supabaseAdmin');

router.get('/', async (req, res) => {
  const userId = req.user.id;

  const { data: events, error: eventError } = await supabase
    .from('tw_events')
    .select('*');

  const { data: registrations, error: regError } = await supabase
    .from('tw_registrations')
    .select('event_id')
    .eq('user_id', userId);

  if (eventError || regError) {
    console.error('Error loading TechWeekend dashboard:', eventError || regError);
    return res.status(500).send('Error loading TechWeekend dashboard');
  }

  const registeredIds = new Set(registrations.map(r => r.event_id));
  const userEmail = req.user?.email || req.user?.emails?.[0]?.value;
  let isAdmin = false;

  if (userEmail) {
    try {
      const { data, error } = await supabaseAdmin
        .from('admins')
        .select('email')
        .eq('email', userEmail)
        .single();

      if (error) {
        console.error('Error checking admin:', error);
      }

      if (data) {
        isAdmin = true;
      }
    } catch (err) {
      console.error('Unexpected error checking admin:', err);
    }
  }
  res.render('tech-weekend', {
    events: events || [],
    registeredIds,
    user: req.user,
    isAdmin
  });
});

router.post('/register/:eventId', async (req, res) => {
  const userId = String(req.user.id);
  const eventId = req.params.eventId;
  const { phone_number } = req.body;

  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(phone_number)) {
    return res.status(400).send('Invalid phone number format');
  }

  // ✅ Fetch display_name from tw_users table
  const { data: twUser, error: twUserError } = await supabaseAdmin
    .from('tw_users')
    .select('display_name')
    .eq('id', userId)
    .single();

  if (twUserError) {
    console.error('Error fetching TechWeekend user display_name:', twUserError);
    return res.status(500).send('Could not fetch TechWeekend user info');
  }

  const displayName = twUser?.display_name || req.user.displayName || '';

  // ✅ Insert registration with display_name
  const { error } = await supabaseAdmin
    .from('tw_registrations')
    .insert([{
      user_id: userId,
      event_id: eventId,
      phone_number,
      display_name: displayName
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
            You may have already registered for this event. Please return to the TechWeekend dashboard to verify.
          </p>
          <a href="/tech-weekend" 
            class="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition">
            Back to TechWeekend Dashboard
          </a>
        </div>
      </body>
      </html>
    `);
  }

  res.redirect('/tech-weekend');
});

module.exports = router;
