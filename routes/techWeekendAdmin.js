const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../supabaseAdmin');
const { Parser } = require('json2csv');
const isAdmin = require('../middleware/isAdmin');

router.get('/', isAdmin, (req, res) => {
  res.redirect('/admin/techweekend/dashboard');
});

router.get('/dashboard', isAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tw_registrations')
    .select(`
      user_id,
      phone_number,
      tw_users: user_id (email, display_name),
      tw_events: event_id (id, name)
    `);

  if (error) {
    console.error('Error fetching TechWeekend dashboard data:', error);
    return res.status(500).send('Error loading admin dashboard');
  }

  const grouped = {};
  data.forEach(r => {
    const email = r.tw_users?.email;
    const name = r.tw_users?.display_name;
    const phone = r.phone_number;
    const event = { id: r.tw_events?.id, name: r.tw_events?.name };

    if (!grouped[email]) {
      grouped[email] = { email, display_name: name, phone_number: phone, events: [event] };
    } else {
      grouped[email].events.push(event);
    }
  });

  const groupedData = Object.values(grouped).map(u => ({
    email: u.email,
    display_name: u.display_name,
    phone_number: u.phone_number,
    events_registered: u.events.map(e => e.name).join(', '),
    total_events: u.events.length,
    event_ids: u.events.map(e => e.id)
  }));

  const { data: events, error: eventError } = await supabaseAdmin
    .from('tw_events')
    .select('id, name, poster_url, event_description');

  if (eventError) {
    console.error('Error fetching events:', eventError);
    return res.status(500).send('Error loading events');
  }

  res.render('techweekend_admin_dashboard', { registrations: groupedData, events });
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

router.post('/events/add', isAdmin, async (req, res) => {
  const { name, poster_url, event_description } = req.body;

  const { error } = await supabaseAdmin
    .from('tw_events')
    .insert([{ name, poster_url, event_description }]);

  if (error) {
    console.error('Error adding event:', error);
    return res.status(500).send('Error adding event');
  }

  res.redirect('/admin/techweekend/dashboard');
});

router.post('/events/edit/:id', isAdmin, async (req, res) => {
  const eventId = req.params.id;
  const { name, poster_url, event_description } = req.body;

  const { error } = await supabaseAdmin
    .from('tw_events')
    .update({ name, poster_url, event_description })
    .eq('id', eventId);

  if (error) {
    console.error('Error editing event:', error);
    return res.status(500).send('Error editing event');
  }

  res.redirect('/admin/techweekend/dashboard');
});

router.post('/events/delete/:id', isAdmin, async (req, res) => {
  const eventId = req.params.id;

  const { error } = await supabaseAdmin
    .from('tw_events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error('Error deleting event:', error);
    return res.status(500).send('Error deleting event');
  }

  res.redirect('/admin/techweekend/dashboard');
});


module.exports = router;
