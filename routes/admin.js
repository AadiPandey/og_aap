const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../supabaseAdmin');
const { Parser } = require('json2csv');
const isAdmin = require('../middleware/isAdmin');

router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const { data: registrationsData, error: regError } = await supabaseAdmin
      .from('course_registrations')
      .select(`
        user_id,
        users: user_id (email, display_name),
        cte_courses: course_id (id, name)
      `);

    if (regError) {
      console.error('Error fetching registrations:', regError);
      return res.status(500).send('Error loading registrations');
    }

    const grouped = {};
    registrationsData.forEach(r => {
      const email = r.users?.email;
      const name = r.users?.display_name;
      const course = { id: r.cte_courses?.id, name: r.cte_courses?.name };

      if (!grouped[email]) {
        grouped[email] = { email, display_name: name, courses: [course] };
      } else {
        grouped[email].courses.push(course);
      }
    });

    const groupedData = Object.values(grouped).map(u => ({
      email: u.email,
      display_name: u.display_name,
      courses_registered: u.courses.map(c => c.name).join(', '),
      total_courses: u.courses.length,
      course_ids: u.courses.map(c => c.id)
    }));

    const { data: courses, error: courseError } = await supabaseAdmin
      .from('cte_courses')
      .select('*');

    if (courseError) {
      console.error('Error fetching courses:', courseError);
      return res.status(500).send('Error loading courses');
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    console.log(page,limit,offset); 
    const { data: users, error: userError, count } = await supabaseAdmin
      .from('users')
      .select('email, display_name, created_at', { count: 'exact' })
      .order('display_name',{ascending:true})
      .range(offset, offset + limit - 1);

    if (userError) {
      console.error('Error fetching users:', userError);
      return res.status(500).send('Error loading users');
    }

    const { data: admins } = await supabaseAdmin.from('admins').select('email');
    const adminEmails = admins?.map(a => a.email) || [];

    const annotatedUsers = users.map(u => ({
      ...u,
      role: adminEmails.includes(u.email) ? 'Admin' : 'User'
    }));

    const totalPages = Math.ceil((count || 0) / limit);
    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;

    const activeTab = req.query.tab || null;

    res.render('admin_dashboard', {
      registrations: groupedData,
      courses,
      users: annotatedUsers,
      totalPages,
      currentPage: page,
      prevPage,
      nextPage,
      limit,
      user: req.user,
      isAdmin: true,
      activeTab
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Internal Server Error');
  }
});


router.get('/registrations/download', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('course_registrations')
    .select(`
      user_id,
      users: user_id (email, display_name),
      cte_courses: course_id (name)
    `);

  if (error) {
    console.error('Error downloading registrations:', error);
    return res.status(500).send('Download failed');
  }

  const grouped = {};
  data.forEach(r => {
    const email = r.users?.email;
    const name = r.users?.display_name;
    const course = r.cte_courses?.name;

    if (!grouped[email]) {
      grouped[email] = {
        email,
        display_name: name,
        courses: [course]
      };
    } else {
      grouped[email].courses.push(course);
    }
  });

  const flatData = Object.values(grouped).map(u => ({
    email: u.email,
    display_name: u.display_name,
    courses_registered: u.courses.join(', '),
    total_courses: u.courses.length
  }));

  const parser = new Parser();
  const csv = parser.parse(flatData);

  res.header('Content-Type', 'text/csv');
  res.attachment('registrations_grouped.csv');
  res.send(csv);
});

router.get('/registrations/:courseId/download', async (req, res) => {
  const { courseId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('course_registrations')
    .select(`
      user_id,
      users: user_id (email, display_name)
    `)
    .eq('course_id', courseId);

  if (error) {
    console.error('Error downloading course registrations:', error);
    return res.status(500).send('Download failed');
  }

  if (!data || data.length === 0) {
    return res.status(404).send('No registrations found for this course');
  }

  const flatData = data.map(r => ({
    email: r.users?.email,
    display_name: r.users?.display_name
  }));

  const parser = new Parser();
  const csv = parser.parse(flatData);

  res.header('Content-Type', 'text/csv');
  res.attachment(`registrations_${courseId}.csv`);
  res.send(csv);
});

router.post('/courses/add', async (req, res) => {
  const { name, poster_url, course_description, handout_url } = req.body;

  const { error } = await supabaseAdmin
    .from('cte_courses')
    .insert([{ name, poster_url, course_description, handout_url }]);

  if (error) {
    console.error('Error adding course:', error);
    return res.status(500).send('Failed to add course');
  }

  res.redirect('/admin/dashboard');
});

router.post('/courses/:id/delete', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('cte_courses')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting course:', error);
    return res.status(500).send('Failed to delete course');
  }

  res.redirect('/admin/dashboard');
});

router.post('/courses/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { name, poster_url, course_description, handout_url } = req.body;

  const { error } = await supabaseAdmin
    .from('cte_courses')
    .update({ name, poster_url, course_description, handout_url })
    .eq('id', id);

  if (error) {
    console.error('Error editing course:', error);
    return res.status(500).send('Failed to edit course');
  }

  res.redirect('/admin/dashboard');
});

router.post('/promote', isAdmin, async (req, res) => {
  const email = req.body.email;
  const { error } = await supabaseAdmin.from('admins').insert([{ email }]);
  if (error) {
    console.error('Error promoting user:', error);
  }
  res.redirect('/admin/dashboard?tab=users');
});

router.post('/demote', isAdmin, async (req, res) => {
  const email = req.body.email;
  const { error } = await supabaseAdmin.from('admins').delete().eq('email', email);
  if (error) {
    console.error('Error demoting user:', error);
  }
  res.redirect('/admin/dashboard?tab=users');
});


module.exports = router;