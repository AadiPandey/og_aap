const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../supabaseAdmin');
const { Parser } = require('json2csv');
const isAdmin = require('../middleware/isAdmin');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', isAdmin, (req, res) => {
  res.redirect('/admin/techweekend/dashboard');
});

router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    // --- Registrations pagination ---
    const regPage = parseInt(req.query.regPage) || 1;
    const regLimit = parseInt(req.query.regLimit) || 20;
    const regOffset = (regPage - 1) * regLimit;

    const { data, error, count } = await supabaseAdmin
      .from('tw_registrations')
      .select(`
        user_id,
        phone_number,
        tw_users: user_id (email, display_name),
        tw_events: event_id (id, name)
      `, { count: 'exact' })
      .range(regOffset, regOffset + regLimit - 1);

    if (error) {
      console.error('Error fetching TechWeekend dashboard data:', error);
      return res.status(500).send('Error loading admin dashboard');
    }

    // Flatten into raw rows
    const registrations = data.map(r => ({
      user_id: r.user_id,
      email: r.tw_users?.email,
      display_name: r.tw_users?.display_name,
      phone_number: r.phone_number,
      event_name: r.tw_events?.name,
      event_id: r.tw_events?.id
    }));

    // Sort alphabetically by display name
    registrations.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));

    // --- Events list ---
    const { data: events, error: eventError } = await supabaseAdmin
      .from('tw_events')
      .select('id, name, poster_url, event_description');

    if (eventError) {
      console.error('Error fetching events:', eventError);
      return res.status(500).send('Error loading events');
    }

    // Pagination metadata
    const totalPages = Math.ceil((count || 0) / regLimit);
    const prevPage = regPage > 1 ? regPage - 1 : null;
    const nextPage = regPage < totalPages ? regPage + 1 : null;

    res.render('techweekend_admin_dashboard', {
      registrations,
      events,
      registrationsTotalPages: totalPages,
      registrationsCurrentPage: regPage,
      registrationsPrevPage: prevPage,
      registrationsNextPage: nextPage,
      registrationsLimit: regLimit
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/techweekend/registrations/delete', isAdmin, async (req, res) => {
  try {
    const { user_id, event_id } = req.body;

    const { error } = await supabaseAdmin
      .from('tw_registrations')
      .delete()
      .match({ user_id, event_id });

    if (error) {
      console.error('Error deleting registration:', error);
      return res.status(500).send('Error deleting registration');
    }

    res.redirect('/admin/dashboard?tab=registrations');
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Internal Server Error');
  }
});


router.get('/registrations/download', isAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tw_registrations')
    .select(`
      user_id,
      phone_number,
      tw_users: user_id (email, display_name),
      tw_events: event_id (name)
    `);

  if (error) {
    console.error('Error downloading TechWeekend registrations:', error);
    return res.status(500).send('Download failed');
  }

  const grouped = {};
  data.forEach(r => {
    const email = r.tw_users?.email;
    const name = r.tw_users?.display_name;
    const phone = r.phone_number;
    const event = r.tw_events?.name;

    if (!grouped[email]) {
      grouped[email] = { email, display_name: name, phone_number: phone, events: [event] };
    } else {
      grouped[email].events.push(event);
    }
  });

  const flatData = Object.values(grouped).map(u => ({
    email: u.email,
    display_name: u.display_name,
    phone_number: u.phone_number,
    events_registered: u.events.join(', '),
    total_events: u.events.length
  }));

  const parser = new Parser();
  const csv = parser.parse(flatData);

  res.header('Content-Type', 'text/csv');
  res.attachment('techweekend_registrations_grouped.csv');
  res.send(csv);
});

router.get('/registrations/:eventId/download', isAdmin, async (req, res) => {
  const { eventId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('tw_registrations')
    .select(`
      user_id,
      phone_number,
      tw_users: user_id (email, display_name)
    `)
    .eq('event_id', eventId);

  if (error) {
    console.error('Error downloading event registrations:', error);
    return res.status(500).send('Download failed');
  }

  if (!data || data.length === 0) {
    return res.status(404).send('No registrations found for this event');
  }

  const flatData = data.map(r => ({
    email: r.tw_users?.email,
    display_name: r.tw_users?.display_name,
    phone_number: r.phone_number
  }));

  const parser = new Parser();
  const csv = parser.parse(flatData);

  res.header('Content-Type', 'text/csv');
  res.attachment(`techweekend_registrations_${eventId}.csv`);
  res.send(csv);
});


router.post('/events/add', isAdmin, upload.single('poster'), async (req, res) => {
  try {
    const { name, event_description } = req.body;
    const posterFile = req.file;

    if (!posterFile) {
      return res.status(400).send('Poster file is required');
    }

    const posterPath = `events/${Date.now()}_${posterFile.originalname}`;

    const { error: posterError } = await supabaseAdmin.storage
      .from('tw_event_posters')
      .upload(posterPath, posterFile.buffer, {
        contentType: posterFile.mimetype,
      });
    if (posterError) throw posterError;

    const { data: posterData } = supabaseAdmin
      .storage
      .from('tw_event_posters')
      .getPublicUrl(posterPath);

    const posterUrl = posterData.publicUrl;

    const { error } = await supabaseAdmin
      .from('tw_events')
      .insert([{ name, event_description, poster_url: posterUrl }]);

    if (error) throw error;

    res.redirect('/admin/techweekend/dashboard');
  } catch (err) {
    console.error('Error adding event:', err);
    res.status(500).send('Error adding event');
  }
});

router.post('/events/edit/:id', isAdmin, upload.single('poster'), async (req, res) => {
  const eventId = req.params.id;
  const { name, event_description } = req.body;

  try {
    const { data: event, error: fetchError } = await supabaseAdmin
      .from('tw_events')
      .select('poster_url')
      .eq('id', eventId)
      .single();

    if (fetchError) throw fetchError;

    let posterUrl = event.poster_url;

    if (req.file) {
      const posterFile = req.file;
      const posterPath = `events/${Date.now()}_${posterFile.originalname}`;

      const { error: posterError } = await supabaseAdmin.storage
        .from('tw_event_posters')
        .upload(posterPath, posterFile.buffer, {
          contentType: posterFile.mimetype,
        });
      if (posterError) throw posterError;

      const { data: posterData } = supabaseAdmin
        .storage
        .from('tw_event_posters')
        .getPublicUrl(posterPath);

      posterUrl = posterData.publicUrl;
    }

    const { error } = await supabaseAdmin
      .from('tw_events')
      .update({ name, event_description, poster_url: posterUrl })
      .eq('id', eventId);

    if (error) throw error;

    res.redirect('/admin/techweekend/dashboard');
  } catch (err) {
    console.error('Error editing event:', err);
    res.status(500).send('Error editing event');
  }
});

router.post('/events/delete/:id', isAdmin, async (req, res) => {
  const eventId = req.params.id;

  try {
    const { data: event, error: fetchError } = await supabaseAdmin
      .from('tw_events')
      .select('poster_url')
      .eq('id', eventId)
      .single();

    if (fetchError) throw fetchError;

    if (event.poster_url) {
      const posterPath = event.poster_url.split('/tw_event_posters/')[1];
      if (posterPath) {
        await supabaseAdmin.storage.from('tw_event_posters').remove([posterPath]);
      }
    }

    const { error } = await supabaseAdmin
      .from('tw_events')
      .delete()
      .eq('id', eventId);

    if (error) throw error;

    res.redirect('/admin/techweekend/dashboard');
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).send('Error deleting event');
  }
});

module.exports = router;
