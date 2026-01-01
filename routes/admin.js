const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../supabaseAdmin');
const { Parser } = require('json2csv');
const isAdmin = require('../middleware/isAdmin');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const { data: registrationsData, error: regError } = await supabaseAdmin
      .from('course_registrations')
      .select(`
        user_id,
        users: user_id (email, display_name,phone_number),
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
      const phone = r.users?.phone_number;
      const course = { id: r.cte_courses?.id, name: r.cte_courses?.name };

      if (!grouped[email]) {
        grouped[email] = { email, display_name: name, phone_number: phone, courses: [course] };
      } else {
        grouped[email].courses.push(course);
      }
    });

    const groupedData = Object.values(grouped).map(u => ({
      email: u.email,
      display_name: u.display_name,
      phone_number: u.phone_number,
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
    const { data: users, error: userError, count } = await supabaseAdmin
      .from('users')
      .select('email, display_name,phone_number, created_at', { count: 'exact' })
      .order('display_name', { ascending: true })
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
      users: user_id (email, display_name,phone_number),
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
    const phone = r.users?.phone_number;
    const course = r.cte_courses?.name;

    if (!grouped[email]) {
      grouped[email] = {
        email,
        display_name: name,
        phone_number: phone,
        courses: [course]
      };
    } else {
      grouped[email].courses.push(course);
    }
  });

  const flatData = Object.values(grouped).map(u => ({
    email: u.email,
    display_name: u.display_name,
    phone_number: u.phone_number,
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
      users: user_id (email, display_name,phone_number)
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
    display_name: r.users?.display_name,
    phone_number: r.users?.phone_number
  }));

  const parser = new Parser();
  const csv = parser.parse(flatData);

  res.header('Content-Type', 'text/csv');
  res.attachment(`registrations_${courseId}.csv`);
  res.send(csv);
});

router.post('/courses/add', isAdmin, upload.fields([
  { name: 'poster', maxCount: 1 },
  { name: 'handout', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, course_description } = req.body;
    const posterFile = req.files.poster?.[0];
    const handoutFile = req.files.handout?.[0];

    const posterPath = `posters/${Date.now()}_${posterFile.originalname}`;
    const handoutPath = `handouts/${Date.now()}_${handoutFile.originalname}`;

    const { error: posterError } = await supabaseAdmin.storage
      .from('course_posters')
      .upload(posterPath, posterFile.buffer, {
        contentType: posterFile.mimetype,
      });
    if (posterError) throw posterError;

    const { error: handoutError } = await supabaseAdmin.storage
      .from('course_handouts')
      .upload(handoutPath, handoutFile.buffer, {
        contentType: handoutFile.mimetype,
      });
    if (handoutError) throw handoutError;

    const { data: posterData } = supabaseAdmin
      .storage
      .from('course_posters')
      .getPublicUrl(posterPath);

    const { data: handoutData } = supabaseAdmin
      .storage
      .from('course_handouts')
      .getPublicUrl(handoutPath);

    const posterUrl = posterData.publicUrl;
    const handoutUrl = handoutData.publicUrl;

    console.log('Poster URL:', posterUrl);
    console.log('Handout URL:', handoutUrl);

    // Insert into DB
    const { error } = await supabaseAdmin
      .from('cte_courses')
      .insert([{
        name,
        course_description,
        poster_url: posterUrl,
        handout_url: handoutUrl,
      }]);

    if (error) throw error;

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error adding course:', err);
    res.status(500).send('Failed to add course');
  }
});


router.post('/courses/:id/delete', isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: course, error: fetchError } = await supabaseAdmin
      .from('cte_courses')
      .select('poster_url, handout_url')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const posterPath = course.poster_url?.split('/course_posters/')[1];
    const handoutPath = course.handout_url?.split('/course_handouts/')[1];

    if (posterPath) {
      await supabaseAdmin.storage.from('course_posters').remove([posterPath]);
    }
    if (handoutPath) {
      await supabaseAdmin.storage.from('course_handouts').remove([handoutPath]);
    }

    const { error } = await supabaseAdmin
      .from('cte_courses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error deleting course:', err);
    res.status(500).send('Failed to delete course');
  }
});

router.post('/courses/:id/edit', isAdmin, upload.fields([
  { name: 'poster', maxCount: 1 },
  { name: 'handout', maxCount: 1 }
]), async (req, res) => {
  const { id } = req.params;
  const { name, course_description } = req.body;

  try {
    const { data: course, error: fetchError } = await supabaseAdmin
      .from('cte_courses')
      .select('poster_url, handout_url')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    let posterUrl = course.poster_url;
    let handoutUrl = course.handout_url;

    if (req.files.poster) {
      const posterFile = req.files.poster[0];
      const posterPath = `posters/${Date.now()}_${posterFile.originalname}`;
      const { error: posterError } = await supabaseAdmin.storage
        .from('course_posters')
        .upload(posterPath, posterFile.buffer, {
          contentType: posterFile.mimetype,
        });
      if (posterError) throw posterError;

      const { data: posterData } = supabaseAdmin
        .storage
        .from('course_posters')
        .getPublicUrl(posterPath);

      posterUrl = posterData.publicUrl;
    }

    if (req.files.handout) {
      const handoutFile = req.files.handout[0];
      const handoutPath = `handouts/${Date.now()}_${handoutFile.originalname}`;
      const { error: handoutError } = await supabaseAdmin.storage
        .from('course_handouts')
        .upload(handoutPath, handoutFile.buffer, {
          contentType: handoutFile.mimetype,
        });
      if (handoutError) throw handoutError;

      const { data: handoutData } = supabaseAdmin
        .storage
        .from('course_handouts')
        .getPublicUrl(handoutPath);

      handoutUrl = handoutData.publicUrl;
    }

    const { error } = await supabaseAdmin
      .from('cte_courses')
      .update({
        name,
        course_description,
        poster_url: posterUrl,
        handout_url: handoutUrl,
      })
      .eq('id', id);

    if (error) throw error;

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error editing course:', err);
    res.status(500).send('Failed to edit course');
  }
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