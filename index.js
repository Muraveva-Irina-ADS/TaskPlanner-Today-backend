import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authMiddleware } from './AuthMiddleware.js';

// Загружаем переменные окружения из .env файла
dotenv.config();

const PORT = process.env.PORT || 7000;
const { Pool } = pg;
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});
const app = express();
app.use(cors());
app.use(express.json());

// Функция для генерации JWT
const generateToken = (user) => jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });

//Регистрация
app.post('/api/registration', async (req, res) => {
    const { first_name, last_name, email, password, phone_number, birthday } = req.body;
    if (!first_name || !last_name || !email || !password || !phone_number || !birthday) {
        return res.status(400).json({ error: 'Все поля должны быть заполнены' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      await pool.query('BEGIN');
      const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0)
        return res.status(400).json({ error: 'Пользователь с таким email уже существует' });      
      const result = await pool.query(`INSERT INTO users (first_name, last_name, email, password, role_name, birthday, phone_number, note, 
          created_at, last_password_change_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
          RETURNING *`, [first_name, last_name, email, hashedPassword, 'user', birthday, phone_number, '']);
      const newUser = result.rows[0];
      const adminResult = await pool.query('SELECT id FROM users WHERE note = $1 LIMIT 1', ['Администратор системы']);
      if (adminResult.rows.length > 0) {
          const adminId = adminResult.rows[0].id;
          const settingsResult = await pool.query('SELECT * FROM settings WHERE users_id = $1', [adminId]);
          if (settingsResult.rows.length > 0) {
              const adminSettings = settingsResult.rows[0];
              await pool.query(
                  `INSERT INTO settings (users_id, limit_tasks, pomodoro_duration,start_working_day, end_working_day, number_pomodoro_per_day, 
                    rest_duration) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [newUser.id, adminSettings.limit_tasks, adminSettings.pomodoro_duration, adminSettings.start_working_day,
                  adminSettings.end_working_day, adminSettings.number_pomodoro_per_day, adminSettings.rest_duration]);
          }
          const matrixResult = await pool.query('SELECT * FROM matrix WHERE users_id = $1', [adminId]);
          for (const matrixRow of matrixResult.rows) {
              await pool.query(
                  `INSERT INTO matrix (users_id, matrix_part, matrix_name, description, color) VALUES ($1, $2, $3, $4, $5)`,
                  [newUser.id, matrixRow.matrix_part, matrixRow.matrix_name, matrixRow.description, matrixRow.color]);
          }
          const statusResult = await pool.query('SELECT * FROM status WHERE users_id = $1', [adminId]);
          for (const statusRow of statusResult.rows) {
              await pool.query(`INSERT INTO status (users_id, status_name, system_code) VALUES ($1, $2, $3)`,
                  [newUser.id, statusRow.status_name, statusRow.system_code]);
          }
      } else {
        await pool.query('ROLLBACK');
        return res.status(401).json({ error: 'Ошибка регистрации' });
      }
      await pool.query('COMMIT');
      const token = generateToken({ email: email, role: 'user' });
      res.json({ token, user: result.rows[0] });
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error('Ошибка регистрации:', err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка регистрации: Введено слишком длинное значение' });
      else 
        res.status(500).json({ error: 'Ошибка регистрации' });
    }
});
//Авторизация
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user;
        user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (!user.rows.length) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }  
        const isMatch = await bcrypt.compare(password, user.rows[0].password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        const token = generateToken({ email: user.rows[0].email, role: user.rows[0].role_name });
        res.json({ token, user: user.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка авторизации' });
    }
});
//Получение данных о настройках по email
app.get('/api/profile_settings_email/', authMiddleware, async (req, res) => {
  const email = req.userEmail;
    try {
      let query;
      let values = [email];
      if (req.userRole !== 'admin' && req.userEmail !== email) {
        return res.status(403).json({ error: 'Нет доступа к данным другого пользователя' });
      }
      query = 'SELECT settings.* FROM settings JOIN users ON settings.users_id = users.id WHERE users.email = $1';
      const result = await pool.query(query, values);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ошибка при получении информации о пользователе' });
    }
  });
  app.get('/api/profile_user_email/', authMiddleware, async (req, res) => {
    const email = req.userEmail;
    try {
      let query;
      let values = [email];
      if (req.userEmail !== email) {
        return res.status(403).json({ error: 'Нет доступа к данным другого пользователя' });
      }
      query = 'SELECT * FROM users WHERE users.email = $1';
      const result = await pool.query(query, values);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ошибка при получении информации о пользователе' });
    }
  });
app.put('/api/profile_put/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { last_name, first_name, email, curPassword, newPassword, phone_number, birthday, role_name, note } = req.body;
      try {
          const userExists = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
          if (userExists.rows.length === 0) {
              return res.status(404).json({ error: 'Пользователь не найден' });
          }
          if (!first_name || !last_name || !email || !role_name || !note || !phone_number || !birthday) {
              return res.status(400).json({ error: 'Все поля должны быть заполнены перед изменением' });
          }
          if (userExists.rows[0].email != email) {
              const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
              if (existingUser.rows.length > 0) {
                  return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
              }
          }
          if (userExists.rows[0].note === 'Администратор системы' && (note !== 'Администратор системы' || role_name !== 'admin'))
            return res.status(400).json({ error: 'Вы являетесь главным администратором. Перед изменением значения поля Замечания, значение "Администратор системы" должно быть у другого администратора' });
            if (userExists.rows[0].note !== 'Администратор системы' && note === 'Администратор системы')
            return res.status(400).json({ error: 'Вы не являетесь главным администратором. Перед изменением значения поля Замечания, значение "Администратор системы" не должно быть у другого администратора' });      
          if (curPassword === '' || curPassword === undefined) {
            const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8 WHERE id = $9 RETURNING *',
            [first_name, last_name, email, userExists.rows[0].password, role_name, birthday, phone_number, note, id]);
            res.json({ user: result.rows[0] });
          }
          const isMatch = await bcrypt.compare(curPassword, userExists.rows[0].password);
          if (isMatch && (newPassword === '' || newPassword === undefined)) {
            const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8 WHERE id = $9 RETURNING *',
            [first_name, last_name, email, userExists.rows[0].password, role_name, birthday, phone_number, note, id]);
            res.json({ user: result.rows[0] });
          }
          else if (isMatch && (newPassword !== '' && newPassword !== undefined && newPassword.length >= 6)) {
            const isMatchNew = await bcrypt.compare(newPassword, userExists.rows[0].password);
            if (isMatchNew)
                return res.status(400).json({ error: 'Текущий и новый пароли не должны совпадать' });
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8, last_password_change_date = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *',
            [first_name, last_name, email, hashedNewPassword, role_name, birthday, phone_number, note, id]);
            res.json({ user: result.rows[0] });
          }
          else {
              if ((curPassword !== undefined && curPassword.length < 6) || (newPassword !== undefined && newPassword.length < 6)) {
                  return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
              }
              else {
                  return res.status(400).json({ error: 'Неверный пароль' });
              }
          }
      } catch (err) {
          console.error(err);
          if (err.message.includes('значение не умещается в тип'))
            res.status(500).json({ error: 'Ошибка обновления информации: Введено слишком длинное значение' });
          else 
            res.status(500).json({ error: 'Ошибка обновления информации о пользователе' });
      }
});
//Изменение данных о настройках пользователя по id
app.put('/api/settings_put/:users_id', authMiddleware, async (req, res) => {
  const { users_id } = req.params;
  const { formData } = req.body;
      try {
        if (!formData.limit_tasks || !formData.pomodoro_duration || !formData.start_working_day || !formData.end_working_day || !formData.number_pomodoro_per_day || !formData.rest_duration) {
          return res.status(400).json({ error: 'Все поля должны быть заполнены перед изменением' });
        }
      const result = await pool.query('UPDATE settings SET limit_tasks = $1, pomodoro_duration = $2, start_working_day = $3, end_working_day = $4, number_pomodoro_per_day = $5, rest_duration = $6 WHERE users_id = $7 RETURNING *',
            [formData.limit_tasks, formData.pomodoro_duration, formData.start_working_day, formData.end_working_day, formData.number_pomodoro_per_day, formData.rest_duration, users_id]);
            res.json({ settings: result.rows[0] });
      } catch (err) {
          console.error(err);
          if (err.message.includes('значение не умещается в тип'))
            res.status(500).json({ error: 'Ошибка обновления информации: Введено слишком длинное значение' });
          else 
            res.status(500).json({ error: 'Ошибка обновления информации о пользователе' });
      }
});
app.get('/api/profile_matrix_email/', authMiddleware, async (req, res) => {
  const email = req.userEmail;
  try {
    let query;
    let values = [email];
    if (req.userRole !== 'admin' && req.userEmail !== email) {
      return res.status(403).json({ error: 'Нет доступа к данным другого пользователя' });
    }
    query = 'SELECT matrix.* FROM matrix JOIN users ON matrix.users_id = users.id WHERE users.email = $1 ORDER BY matrix_part';
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках матрицы пользователя' });
  }
});
//Изменение данных о настройках матрицы пользователя по id
app.put('/api/matrix_put/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { users_id, matrix_part, name, description, color } = req.body;
      try {
          if (matrix_part <= 0 || !name || !description) {
              return res.status(400).json({ error: 'Все поля должны быть заполнены' });
          }        
      const result = await pool.query('UPDATE matrix SET users_id = $1, matrix_part = $2, matrix_name = $3, description = $4, color = $5 WHERE id = $6 RETURNING *',
            [users_id, matrix_part, name, description, color, id]);
            res.json({ matrix: result.rows[0] });
      } catch (err) {
          console.error(err);
          if (err.message.includes('значение не умещается в тип'))
            res.status(500).json({ error: 'Ошибка обновления информации о матрице: Введено слишком длинное значение' });
          else 
            res.status(500).json({ error: 'Ошибка обновления информации о матрице пользователя' });
      }
});
app.get('/api/profile_status_email/', authMiddleware, async (req, res) => {
  const email = req.userEmail;
  try {
    let query;
    let values = [email];
    if (req.userRole !== 'admin' && req.userEmail !== email) {
      return res.status(403).json({ error: 'Нет доступа к данным другого пользователя' });
    }
    query = 'SELECT status.* FROM status JOIN users ON status.users_id = users.id WHERE users.email = $1';
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках матрицы пользователя' });
  }
});
app.get('/api/profile_settings_note/:note', authMiddleware, async (req, res) => {
  const { note } = req.params;
  try {
    let query;
    let values = [note];
    query = 'SELECT settings.* FROM settings JOIN users ON settings.users_id = users.id WHERE users.note = $1';
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки администратора не найдены' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках администратора' });
  }
});
app.get('/api/profile_matrix_note', async (req, res) => {
  try {
    let query;
    query = 'SELECT matrix.* FROM matrix JOIN users ON matrix.users_id = users.id WHERE users.note = $1';
    const result = await pool.query(query, ['Администратор системы']);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки матрицы администратора не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках матрицы администратора' });
  }
});
app.get('/api/profile_status_note/:note', authMiddleware, async (req, res) => {
  const { note } = req.params;
  try {
    let query;
    let values = [note];
    query = 'SELECT status.* FROM status JOIN users ON status.users_id = users.id WHERE users.note = $1';
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки статусов администратора не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках статусов администратора' });
  }
});
//Изменение данных о настройках статуса пользователя по id
app.put('/api/status_put/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, users_id, system_code } = req.body;
      try {
          if (!name) {
              return res.status(400).json({ error: 'Все поля должны быть заполнены' });
          }        
      const result = await pool.query('UPDATE status SET status_name = $1, users_id = $2, system_code = $3 WHERE id = $4 RETURNING *',
            [name, users_id, system_code, id]);
            res.json({ status: result.rows[0] });
      } catch (err) {
          console.error(err);
          if (err.message.includes('значение не умещается в тип'))
            res.status(500).json({ error: 'Ошибка изменения информации о статусах: Введено слишком длинное значение' });
          else 
            res.status(500).json({ error: 'Ошибка обновления информации о статусах пользователя' });
      }
});




app.get('/api/settings/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM settings ORDER BY users_id';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки пользователей не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках пользователей' });
  }
});
app.get('/api/users/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM users ORDER BY id';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователей не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о пользователях' });
  }
});
app.get('/api/matrix/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM matrix ORDER BY id';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки матрицы пользователей не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках матрицы пользователей' });
  }
});
app.get('/api/status/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM status ORDER BY id';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Настройки статусов пользователей не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о настройках статусов пользователей' });
  }
});
//Добавление нового статуса
app.post('/api/status_add', authMiddleware,  async (req, res) => {
  const { status_name, users_id, system_code } = req.body;
  if (!status_name || !system_code) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены' });
  }
  try {
    await pool.query('BEGIN');
    const users = await pool.query('SELECT id FROM users');
    const addedStatuses = [];
    for (const user of users.rows) {
      const result = await pool.query(`INSERT INTO status (status_name, users_id, system_code) VALUES ($1, $2, $3) RETURNING *`,
        [status_name, user.id, system_code]
      );
      addedStatuses.push(result.rows[0]);
    }
    await pool.query('COMMIT');
    res.json({ statuses: addedStatuses });
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления статуса: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка добавления статуса' });
  }
});
app.post('/api/execution_status_add', authMiddleware,  async (req, res) => {
  const { exec_status_name, code, color } = req.body;
  if (!exec_status_name || !code || !color) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены' });
  }
  try {
    const result = await pool.query(`INSERT INTO execution_status (exec_status_name, code, exec_color) VALUES ($1, $2, $3) RETURNING *`,
        [exec_status_name, code, color]
      );
    res.json(result.rows);
  } catch (err) {
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления статуса выполнения: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка добавления статуса' });
  }
});
app.post('/api/user_add', authMiddleware, async (req, res) => {
  const { userData } = req.body;
  const emailFromToken = req.userEmail;
  if (!userData.user.first_name || !userData.user.last_name || !userData.user.email || !userData.user.curPassword ||
        !userData.user.phone_number || !userData.user.birthday || !userData.user.note ||
        !userData.settings.limit_tasks || !userData.settings.pomodoro_duration || !userData.settings.start_working_day ||
        !userData.settings.number_pomodoro_per_day || !userData.settings.rest_duration || !userData.settings.end_working_day) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  for (const element of userData.matrix)
      if (element.matrix_part <= 0 || !element.matrix_name || !element.description) {
        return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
    } 
    for (const elem of userData.status)
      if (!elem.status_name) {
        return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
    } 
  try {
    await pool.query('BEGIN');
    let updatedAdminUser = null;
    if (userData.user.note === 'Администратор системы') {
      const adminUser = await pool.query('SELECT * FROM users WHERE note = $1', ['Администратор системы']);
      if (emailFromToken === adminUser.rows[0].email) {
          if (userData.user.role_name === 'admin') {
            const result = await pool.query('UPDATE users SET note = $1 WHERE id = $2 RETURNING *',
              ['Недействующий администратор системы', adminUser.rows[0].id]);
            updatedAdminUser = result.rows[0];
          } else 
            return res.status(400).json({ error: 'Этот пользователь не является администратором, поэтому значение "Администратор системы" в поле Замечания для него недопустимы' });
      } else 
        return res.status(400).json({ error: 'Вы не являетесь главным администратором, поэтому значение "Администратор системы" в поле Замечания Вы установить у пользователя не можете' });
    }
    const hashedPassword = await bcrypt.hash(userData.user.curPassword, 10);
    const userResult = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password, phone_number, birthday, role_name, note, created_at, last_password_change_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
      [userData.user.first_name, userData.user.last_name, userData.user.email, hashedPassword, userData.user.phone_number, userData.user.birthday, 
        userData.user.role_name, userData.user.note]
    );
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO settings (users_id, limit_tasks, pomodoro_duration, start_working_day, end_working_day, number_pomodoro_per_day, rest_duration) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, userData.settings.limit_tasks, userData.settings.pomodoro_duration, userData.settings.start_working_day,
        userData.settings.end_working_day, userData.settings.number_pomodoro_per_day, userData.settings.rest_duration]
    );
    for (const element of userData.matrix) {
      await pool.query(
        `INSERT INTO matrix (users_id, matrix_part, matrix_name, description, color) VALUES ($1, $2, $3, $4, $5)`,
        [userId, element.matrix_part, element.matrix_name, element.description, element.color]
      );
    }
    for (const elem of userData.status) {
      await pool.query(
        `INSERT INTO status (status_name, users_id, system_code) VALUES ($1, $2, $3)`,
        [elem.status_name, userId, elem.system_code]
      );
    }
    await pool.query('COMMIT');
    res.json({ 
      message: 'Пользователь и все связанные данные успешно добавлены',
      userId: userId,
      updatedAdminUser: updatedAdminUser
    });
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления пользователя: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка добавления пользователя' });
  }
});
app.put('/api/user_put/:id',  authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { userData } = req.body;
  const emailFromToken = req.userEmail;
  if (!userData.user.first_name || !userData.user.last_name || !userData.user.email ||
        !userData.user.phone_number || !userData.user.birthday || !userData.user.note ||
        !userData.settings.limit_tasks || !userData.settings.pomodoro_duration || !userData.settings.start_working_day ||
        !userData.settings.number_pomodoro_per_day || !userData.settings.rest_duration || !userData.settings.end_working_day) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  for (const element of userData.matrix)
      if (element.matrix_part <= 0 || !element.matrix_name || !element.description) {
        return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
    } 
    for (const elem of userData.status)
      if (!elem.status_name) {
        return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
    } 
  try {
    await pool.query('BEGIN');
    const userExists = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
          if (userExists.rows.length === 0) {
              return res.status(404).json({ error: 'Пользователь не найден' });
          }
    let updatedAdminUser = null;
    let user = null;
    const adminUser = await pool.query('SELECT * FROM users WHERE note = $1', ['Администратор системы']);
    if (userData.user.note === 'Администратор системы') {
        if (emailFromToken === adminUser.rows[0].email) {
          if (id !== adminUser.rows[0].id)
            if (userData.user.role_name === 'admin') {
              const result = await pool.query('UPDATE users SET note = $1 WHERE id = $2 RETURNING *',
                ['Недействующий администратор системы', adminUser.rows[0].id]);
              updatedAdminUser = result.rows[0];
            } else 
              return res.status(400).json({ error: 'Этот пользователь не является администратором, поэтому значение "Администратор системы" в поле Замечания для него недопустимы' });
        } else
          return res.status(400).json({ error: 'Вы не являетесь главным администратором, поэтому значение "Администратор системы" в поле Замечания Вы установить у пользователя не можете' });
        } else {
      if (emailFromToken === adminUser.rows[0].email && Number(id) === adminUser.rows[0].id)
        return res.status(400).json({ error: 'Вы являетесь главным администратором, поэтому, чтобы поменять значение "Администратор системы" в поле Замечания, Вы должны установить это значение другому администратору' });
    }
    if (userData.user.curPassword === '' || userData.user.curPassword === undefined) {
      const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8 WHERE id = $9 RETURNING *',
      [userData.user.first_name, userData.user.last_name, userData.user.email, userExists.rows[0].password, userData.user.role_name, 
      userData.user.birthday, userData.user.phone_number, userData.user.note, id]);
      user = result.rows[0];
    }
    else {
      const isMatch = await bcrypt.compare(userData.user.curPassword, userExists.rows[0].password);
      if (isMatch && (userData.user.newPassword === '' || userData.user.newPassword === undefined)) {
        const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8 WHERE id = $9 RETURNING *',
        [userData.user.first_name, userData.user.last_name, userData.user.email, userExists.rows[0].password, userData.user.role_name, 
        userData.user.birthday, userData.user.phone_number, userData.user.note, id]);
        user = result.rows[0];
      }
      else if (isMatch && (userData.user.newPassword !== '' && userData.user.newPassword !== undefined && userData.user.newPassword.length >= 6)) {
        const isMatchNew = await bcrypt.compare(userData.user.newPassword, userExists.rows[0].password);
            if (isMatchNew)
                return res.status(400).json({ error: 'Текущий и новый пароли не должны совпадать' });
        const hashedNewPassword = await bcrypt.hash(userData.user.newPassword, 10);
        const result = await pool.query('UPDATE users SET first_name = $1, last_name = $2, email = $3, password = $4, role_name = $5, birthday = $6, phone_number = $7, note = $8, last_password_change_date = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *',
        [userData.user.first_name, userData.user.last_name, userData.user.email, hashedNewPassword, userData.user.role_name, 
          userData.user.birthday, userData.user.phone_number, userData.user.note, id]);
        user = result.rows[0];
      }
      else {
          if ((userData.user.curPassword !== undefined && userData.user.curPassword.length < 6) || (userData.user.newPassword !== undefined && userData.user.newPassword.length < 6)) {
              return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
          }
          else {
              return res.status(400).json({ error: 'Неверный пароль' });
          }
      }
    }
    await pool.query('UPDATE settings SET limit_tasks = $1, pomodoro_duration = $2, start_working_day = $3, end_working_day = $4, number_pomodoro_per_day = $5, rest_duration = $6 WHERE users_id = $7 RETURNING *',
            [userData.settings.limit_tasks, userData.settings.pomodoro_duration, userData.settings.start_working_day, 
              userData.settings.end_working_day, userData.settings.number_pomodoro_per_day, userData.settings.rest_duration, id]);
    for (const element of userData.matrix) {
      await pool.query('UPDATE matrix SET matrix_name = $1, description = $2, color = $3 WHERE users_id = $4 AND matrix_part = $5 RETURNING *',
            [element.matrix_name, element.description, element.color, id, element.matrix_part]);
    }
    for (const elem of userData.status) {
      await pool.query('UPDATE status SET status_name = $1 WHERE users_id = $2 AND system_code = $3 RETURNING *',
            [elem.status_name, id, elem.system_code]);
    }
    await pool.query('COMMIT');
    res.json({ 
      message: 'Пользователь и все связанные данные успешно обновлены',
      updatedAdminUser: updatedAdminUser,
      user: user
    });
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка изменения пользователя: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка изменения пользователя' });
  }
});







app.get('/api/projects/', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    let query;
    query = 'SELECT projects.* FROM projects LEFT JOIN users ON projects.users_id = users.id WHERE users.email = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [emailFromToken]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о проектах пользователя' });
  }
});
app.post('/api/project_add/', authMiddleware, async (req, res) => {
  const { project_name, description, color, is_active } = req.body;
  const emailFromToken = req.userEmail;
  if (!project_name || !description) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  try {
    const user = await pool.query(`SELECT id from users WHERE users.email = $1`, [emailFromToken])
    const projectResult = await pool.query(
      `INSERT INTO projects (users_id, project_name, description, color, is_active, created_at) 
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING id`,
      [user.rows[0].id, project_name, description, color, is_active]
    );    
    res.json(projectResult.rows[0]);
  } catch (err) {
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления проекта: Введено слишком длинное значение' });
      else 
        res.status(500).json({ error: 'Ошибка добавления проекта' });
  }
});
app.delete('/api/project_delete/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('BEGIN');
    const projectExists = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectExists.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Проект не найден' });
    }
    const tasks = await pool.query('SELECT id FROM tasks WHERE project_id = $1', [id]);
    const taskIds = tasks.rows.map(t => t.id);
    if (taskIds.length > 0) {
      await pool.query(`DELETE FROM dates_stages WHERE stage_id IN (SELECT id FROM stages WHERE task_id = ANY($1::int[]))`, [taskIds]);
      await pool.query(`DELETE FROM stages WHERE task_id = ANY($1::int[])`, [taskIds]);
      await pool.query(`DELETE FROM dates_tasks WHERE task_id = ANY($1::int[])`, [taskIds]);
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1::int[])`, [taskIds]);
    }
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    await pool.query('COMMIT');   
      res.json({ message: 'Проект удален' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении проекта' });
  }
});





app.get('/api/projects_with_users/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT projects.*, users.email FROM projects FULL JOIN users ON projects.users_id = users.id ORDER BY created_at DESC';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Проекты пользователей не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о проектах пользователей' });
  }
});
app.put('/api/projects_put/:id',  authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { users_id, project_name, description, color, is_active } = req.body;
  if (!project_name || !description) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  try {
      const result = await pool.query('UPDATE projects SET users_id = $1, project_name = $2, description = $3, color = $4, is_active = $5 WHERE id = $6 RETURNING *',
      [users_id, project_name, description, color, is_active, id]);
      res.json({ project: result.rows[0] });
  } catch (err) {
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка изменения пользователя: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка изменения проекта' });
  }
});









app.get('/api/project/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let query;
    query = 'SELECT * FROM projects WHERE id = $1';
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Проект не найден' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о проекте' });
  }
});
app.get('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let query;
    query = 'SELECT tasks.*, status.status_name, dates_tasks.execution_date, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_tasks LEFT JOIN tasks ON dates_tasks.task_id = tasks.id LEFT JOIN status ON tasks.status_id = status.id LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id WHERE project_id = $1 AND status.system_code != \'завершение\' ORDER BY dates_tasks.execution_date';
    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах проекта' });
  }
});


app.get('/api/tasks_to_user', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    let query;
    query = `
      SELECT
        tasks.task_name,
        tasks.id as task_id,
        tasks.status_id,
        projects.id as project_id,
        status.status_name,
        status.system_code,
        to_char(dates_tasks.execution_date, 'YYYY-MM-DD') as execution_date,
        projects.project_name,
        projects.color as project_color,
        matrix.matrix_name,
        matrix.color as matrix_color,
        execution_status.exec_status_name,
        execution_status.code,
        execution_status.exec_color
      FROM dates_tasks 
      LEFT JOIN tasks ON dates_tasks.task_id = tasks.id 
      LEFT JOIN status ON tasks.status_id = status.id
      LEFT JOIN matrix ON tasks.matrix_id = matrix.id
      LEFT JOIN projects ON tasks.project_id = projects.id 
      LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id
      LEFT JOIN users ON projects.users_id = users.id 
      WHERE users.email = $1
    `;
    const result = await pool.query(query, [emailFromToken]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'У Вас нет задач, создать их можно на странице проекта' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах проекта' });
  }
});
app.get('/api/dates_stages_history_to_user', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  const { startDate, endDate } = req.query;
  try {
    let query;
    query = `
      SELECT
        tasks.task_name,
        tasks.id as task_id,
        projects.id as project_id,
        status.status_name,
        to_char(dates_tasks_history.execution_date, 'YYYY-MM-DD') as execution_date,
        projects.project_name,
        projects.color as project_color,
        matrix.matrix_name,
        matrix.color as matrix_color
      FROM dates_tasks_history
      LEFT JOIN tasks ON dates_tasks_history.task_id = tasks.id 
      LEFT JOIN status ON tasks.status_id = status.id
      LEFT JOIN matrix ON tasks.matrix_id = matrix.id
      LEFT JOIN projects ON tasks.project_id = projects.id 
      LEFT JOIN users ON projects.users_id = users.id 
      WHERE users.email = $1 AND dates_tasks_history.execution_date BETWEEN $2::date AND $3::date
    `;
    const result = await pool.query(query, [emailFromToken, startDate, endDate]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Задачи пользователя не найдены, в указанный период задач нет' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах проекта' });
  }
});



app.get('/api/dates_tasks', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT dates_tasks.*, tasks.task_name, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_tasks LEFT JOIN tasks ON dates_tasks.task_id = tasks.id LEFT JOIN execution_status ON execution_status.id = dates_tasks.exec_status_id ORDER BY dates_tasks.execution_date';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сроки задач не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках задач' });
  }
});
app.get('/api/dates_stages', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT dates_stages.*, stages.stage_name, execution_status.exec_status_name, execution_status.code, execution_status.exec_color  FROM dates_stages LEFT JOIN stages ON dates_stages.stage_id = stages.id LEFT JOIN execution_status ON execution_status.id = dates_stages.exec_status_id ORDER BY dates_stages.execution_date';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сроки задач не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках задач' });
  }
});
app.get('/api/export_date_from_dates_tasks_history', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT MAX(execution_date) as last_export_date FROM dates_tasks_history';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Дата последней выгрузки сроков задач не найдена' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о последней выгрузке сроков задач' });
  }
});
app.post('/api/dates_tasks_history_add', authMiddleware, async (req, res) => {
  const { dateInput } = req.body;
  if (!dateInput) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  try {
    await pool.query('BEGIN');
    const datesTasks = await pool.query(`SELECT * FROM dates_tasks WHERE execution_date BETWEEN 
      (SELECT MIN(execution_date) FROM dates_tasks) AND $1 ORDER BY execution_date ASC;`, [dateInput]);
    if (datesTasks.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Нет данных для переноса за указанный период' });
    }
   for (const row of datesTasks.rows) {
      await pool.query(`INSERT INTO dates_tasks_history (dates_tasks_id, task_id, execution_date, planned_start_time, planned_end_time, actual_start_time,
          actual_end_time, exec_status_id ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [row.id, row.task_id, row.execution_date, row.planned_start_time, row.planned_end_time, row.actual_start_time, row.actual_end_time,
        row.exec_status_id]);
    }
    await pool.query(`DELETE FROM dates_tasks WHERE execution_date BETWEEN (SELECT MIN(execution_date) FROM dates_tasks) AND $1`, [dateInput]);


    const datesStages = await pool.query(`SELECT * FROM dates_stages WHERE execution_date BETWEEN 
      (SELECT MIN(execution_date) FROM dates_stages) AND $1 ORDER BY execution_date ASC;`, [dateInput]);     
    if (datesStages.rows.length !== 0) {
      for (const row of datesStages.rows) {
          await pool.query(`INSERT INTO dates_stages_history (dates_stages_id, stage_id, execution_date, planned_start_time, planned_end_time, actual_start_time,
              actual_end_time, exec_status_id ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
            [row.id, row.stage_id, row.execution_date, row.planned_start_time, row.planned_end_time, row.actual_start_time, row.actual_end_time,
            row.exec_status_id]);
        }
        await pool.query(`DELETE FROM dates_stages WHERE execution_date BETWEEN (SELECT MIN(execution_date) FROM dates_stages) AND $1`, [dateInput]);
    }
    await pool.query('COMMIT');
    res.json({message: `Успешно перенесены записи`});
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Ошибка выгрузки данных в таблицу Сроков задач' });
  }
});


app.get('/api/all_tasks_to_all_projects_not_complete/', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    let query;
    query = `SELECT tasks.task_name, tasks.id as task_id, tasks.matrix_id, projects.id as project_id, status.id as status_id, status.status_name, projects.project_name,
    projects.color as project_color, projects.is_active, tasks.deadline, dates_tasks.execution_date, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_tasks 
    LEFT JOIN tasks ON dates_tasks.task_id = tasks.id LEFT JOIN status ON tasks.status_id = status.id
    LEFT JOIN matrix ON tasks.matrix_id = matrix.id LEFT JOIN projects ON tasks.project_id = projects.id 
    LEFT JOIN users ON projects.users_id = users.id LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id  WHERE users.email = $1 AND status.system_code != \'завершение\' ORDER BY tasks.deadline`;
    const result = await pool.query(query, [emailFromToken]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'У Вас нет задач, создать их можно на странице проекта' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах пользователя' });
  }
});
app.get('/api/all_tasks_to_all_projects_only_complete/', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    let query;
    query = `SELECT tasks.task_name, tasks.description, tasks.id as task_id, tasks.created_at, tasks.matrix_id, projects.id as project_id, status.id as status_id, status.status_name, projects.project_name,
    projects.color as project_color, projects.is_active, tasks.deadline, dates_tasks.execution_date, matrix.matrix_name,
    execution_status.exec_status_name, execution_status.code, execution_status.exec_color, repeat_types.type_name FROM dates_tasks 
    LEFT JOIN tasks ON dates_tasks.task_id = tasks.id LEFT JOIN status ON tasks.status_id = status.id
    LEFT JOIN matrix ON tasks.matrix_id = matrix.id LEFT JOIN projects ON tasks.project_id = projects.id 
    LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id
    LEFT JOIN repeat_types ON repeat_types.id = tasks.repeat_type_id
    LEFT JOIN users ON projects.users_id = users.id WHERE users.email = $1 AND status.system_code = \'завершение\' ORDER BY tasks.deadline`;
    const result = await pool.query(query, [emailFromToken]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'У Вас нет завершенных задач, они появятся, когда вы завершите хотя бы одну задачу' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах пользователя' });
  }
});
app.get('/api/info_task/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { execution_date } = req.query;
    let query;
    query = 'SELECT tasks.*, projects.project_name, projects.color, projects.is_active, projects.id as project_id, matrix.matrix_name, matrix.color as matrix_color, matrix.id as matrix_id, dates_tasks.execution_date, dates_tasks.planned_start_time, dates_tasks.planned_end_time, dates_tasks.actual_start_time, dates_tasks.actual_end_time, execution_status.exec_status_name, execution_status.code, execution_status.exec_color, dates_tasks.exec_status_id, dates_tasks.id as dates_tasks_id, settings.start_working_day, settings.end_working_day, status.status_name, status.system_code FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id LEFT JOIN matrix ON tasks.matrix_id = matrix.id LEFT JOIN dates_tasks ON dates_tasks.task_id = tasks.id LEFT JOIN settings ON projects.users_id = settings.users_id LEFT JOIN status ON status.id = tasks.status_id LEFT JOIN execution_status ON execution_status.id = dates_tasks.exec_status_id WHERE tasks.id = $1 AND dates_tasks.execution_date = $2';
    const result = await pool.query(query, [id, execution_date]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задаче' });
  }
});
app.get('/api/repeat_types/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM repeat_types';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Таблица с типами повторений не найдена' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о типах повторений' });
  }
});
app.get('/api/execution_status/', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT * FROM execution_status';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Таблица с статусами выполнения не найдена' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о статусах выполнения' });
  }
});
app.put('/api/task_put/:id',  authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { value, field, isChangeDeadline} = req.body;
  if (!value)
      return res.status(400).json({ error: 'Значение поля должно быть заполнено перед добавлением' });
  try {
      const result = await pool.query(`UPDATE tasks SET ${field} = $1 WHERE id = $2 RETURNING *`, [value, id]);
      if (field === 'deadline' && isChangeDeadline)
        await pool.query(`UPDATE stages SET ${field} = $1 WHERE task_id = $2 RETURNING *`, [value, id])
      res.json({ project: result.rows[0] });
  } catch (err) {
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка изменения пользователя: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка изменения проекта' });
  }
});
app.put('/api/dates_tasks_put_for_task/',  authMiddleware, async (req, res) => {
  const { formData } = req.body;
  if (!formData.planned_start_time || !formData.planned_end_time) {
      return res.status(400).json({ error: 'Значение поля должно быть заполнено перед добавлением' });
  }
  try {
    const status = await pool.query(`select * from execution_status where code = $1`, [formData.code])
    const result = await pool.query(`UPDATE dates_tasks SET execution_date = $1, planned_start_time = $2, planned_end_time = $3, actual_start_time = $4, actual_end_time = $5, exec_status_id = $6 WHERE id = $7 RETURNING *`,
      [formData.execution_date, formData.planned_start_time, formData.planned_end_time, formData.actual_start_time, formData.actual_end_time, status.rows[0].id, formData.dates_tasks_id]);
      res.json({ dates_tasks: result.rows[0] });
  } catch (err) {
      console.error(err); 
      res.status(500).json({ error: 'Ошибка изменения проекта' });
  }
});
app.put('/api/update_repeat_type/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { repeat_type_id, number_repeat, execution_date, newDates, planned_start_time, planned_end_time } = req.body;
  try {
    await pool.query('BEGIN');
    const result = await pool.query(`UPDATE tasks SET repeat_type_id = $1, number_repeat = $2 WHERE id = $3 RETURNING *`,
      [repeat_type_id, number_repeat, id]);  
    const exec_status = await pool.query(`SELECT * FROM execution_status`)
    const findExecStatusIdByCode = (code) => {
      const st = exec_status.rows.find(s => s.code === code);
      return st ? st.id : null;
    };
    const deletedDates = await pool.query(`DELETE FROM dates_tasks 
       WHERE task_id = $1 AND ((execution_date > $2)) AND exec_status_id != $3 AND exec_status_id != $4
       RETURNING id, execution_date`, 
       [id, execution_date, findExecStatusIdByCode('выполнение'), findExecStatusIdByCode('работа')]);
    if (deletedDates.rows.length > 0) {
      const deletedDateStrings = deletedDates.rows.map(d => d.execution_date);
      await pool.query(`DELETE FROM dates_stages WHERE stage_id IN (SELECT id FROM stages WHERE task_id = $1) AND execution_date = ANY($2::date[])`,
        [id, deletedDateStrings]);
    }
    const existingResult = await pool.query(`SELECT execution_date FROM dates_tasks WHERE task_id = $1`, [id]);
    const existingSet = new Set(
      existingResult.rows.map(row => {
        const date = new Date(row.execution_date);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      })
    );
    const stages = await pool.query(`SELECT id FROM stages WHERE task_id = $1`, [id]);
    for (let i = 0; i < newDates.length; i++) {
      const date = newDates[i];
      if (existingSet.has(date))
        continue;
      try {
        await pool.query(`INSERT INTO dates_tasks (task_id, execution_date, planned_start_time, planned_end_time, 
            actual_start_time, actual_end_time, exec_status_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [id, date, planned_start_time, planned_end_time, '00:00:00', '00:00:00', findExecStatusIdByCode('ожидание')]);
        if (stages.rows.length > 0) {
          for (const stage of stages.rows)
            await pool.query(`INSERT INTO dates_stages (stage_id, execution_date, planned_start_time, planned_end_time, 
                actual_start_time, actual_end_time, exec_status_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [stage.id, date, planned_start_time, planned_end_time, '00:00:00', '00:00:00', findExecStatusIdByCode('ожидание')]);
        }       
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Ошибка при вставке даты' });
      }
    }
    const finalCheck = await pool.query(`SELECT * FROM dates_tasks WHERE task_id = $1 AND exec_status_id != $2`,
      [id, findExecStatusIdByCode('выполнение')]);
    if (finalCheck.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Вы не можете установить такие значения даты и типа повторения, потому что в таком случае у задачи не будет незавершенных записей (все записи (сроки) имеют статус Выполнено)'});
    }
    await pool.query('COMMIT');
    res.json({ deleted: result.rows });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка удаления дат' });
  }
});
app.put('/api/repeat_type_table_put/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { type_name, description } = req.body;
  try {
    const result = await pool.query(`UPDATE repeat_types SET type_name = $1, description = $2 WHERE id = $3 RETURNING *`,[type_name, description, id]);
    res.json({ res: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка изменения типов повторений' });
  }
});
app.put('/api/execution_status_table_put/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { exec_status_name, color } = req.body;
  try {
    const result = await pool.query(`UPDATE execution_status SET exec_status_name = $1, exec_color = $2 WHERE id = $3 RETURNING *`,
      [exec_status_name, color, id]);
    res.json({ res: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка изменения статусов выполнения' });
  }
});
app.put('/api/execution_status_put_overdue', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    await pool.query('BEGIN');
    await pool.query(`UPDATE dates_tasks SET exec_status_id = postponed_status.id
        FROM execution_status postponed_status, execution_status planned_status, tasks, projects, users
        WHERE postponed_status.code = 'просрочка' AND planned_status.code = 'ожидание'
        AND dates_tasks.execution_date < CURRENT_DATE AND dates_tasks.exec_status_id = planned_status.id
        AND dates_tasks.task_id = tasks.id AND tasks.project_id = projects.id AND projects.users_id = users.id AND users.email = $1`, 
        [emailFromToken]);
    await pool.query(`UPDATE dates_stages SET exec_status_id = postponed_status.id
        FROM execution_status postponed_status, execution_status planned_status, stages, tasks, projects, users
        WHERE postponed_status.code = 'просрочка' AND planned_status.code = 'ожидание'
        AND dates_stages.execution_date < CURRENT_DATE AND dates_stages.exec_status_id = planned_status.id
        AND dates_stages.stage_id = stages.id AND stages.task_id = tasks.id AND tasks.project_id = projects.id
        AND projects.users_id = users.id AND users.email = $1;`, [emailFromToken]);  
    await pool.query('COMMIT');
    res.json({ res: 'Обновлено' });
  } catch (err) {
    await pool.query('ROLLBACK')
    console.error(err);
    res.status(500).json({ error: 'Ошибка изменения статусов выполнения на просроченные' });
  }
});
app.get('/api/dates_tasks_for_task/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let query;
    query = `SELECT dates_tasks.*, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_tasks LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id WHERE task_id = $1 AND execution_status.code != 'выполнение'`;
    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках задачи' });
  }
});
app.get('/api/info_dates_tasks/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT dates_tasks.*, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_tasks LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id WHERE task_id = $1 ORDER BY execution_date', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сроки задачи не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках задачи' });
  }
});
app.get('/api/info_dates_stages/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT dates_stages.*, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM dates_stages LEFT JOIN execution_status ON dates_stages.exec_status_id = execution_status.id WHERE stage_id = $1 ORDER BY execution_date', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сроки задачи не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках задачи' });
  }
});
app.post('/api/task_add/', authMiddleware, async (req, res) => {
  const { id, formData } = req.body;
  const emailFromToken = req.userEmail;
  if (!formData.task_name || !formData.description || !formData.deadline) {
    return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  const today = new Date();
  const date = new Date(formData.deadline);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  try {
    await pool.query('BEGIN');
    const user = await pool.query(`SELECT status.id from status LEFT JOIN users ON status.users_id = users.id WHERE users.email = $1 ORDER BY status.id`, [emailFromToken])
    const time = await pool.query(`SELECT settings.start_working_day, settings.end_working_day from settings LEFT JOIN users ON users.id = settings.users_id WHERE users.email = $1`, [emailFromToken])
    if (user.rows.length === 0)  {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ошибка получения данных о статусе пользователя' });
    }
    if (time.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Ошибка получения данных о настройках пользователя' });
    }  
    const result = await pool.query(
      `INSERT INTO tasks (project_id, task_name, description, status_id, matrix_id, deadline, pomodoros_planned, final_deadline, pomodoros_spent, created_at, repeat_type_id, number_repeat) 
       VALUES ($1, $2, $3, $4, $5, $6, -1, '1900-01-01', 0, $7, 1, '{0}') RETURNING id`,
      [id, formData.task_name, formData.description, user.rows[0].id, Number(formData.matrix_id), new Date(`${year}-${month}-${day}`), today]
    );
    const status = await pool.query(`select * from execution_status where code = $1`, ['ожидание'])
    await pool.query(
      `INSERT INTO dates_tasks (task_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
       VALUES ($1, $2, $3, $4, '00:00:00', '00:00:00', $5) RETURNING id`,
      [result.rows[0].id, `${year}-${month}-${day}`,  time.rows[0].start_working_day, time.rows[0].end_working_day, status.rows[0].id]
    );
    await pool.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления задачи: Введено слишком длинное значение' });
      else 
        res.status(500).json({ error: 'Ошибка добавления задачи' });
  }
});
app.put('/api/status_put_for_task/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const emailFromToken = req.userEmail;
  if (!status) {
    return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }  
  try {
    await pool.query('BEGIN');
    const user = await pool.query(`SELECT status.id from status LEFT JOIN users ON status.users_id = users.id WHERE users.email = $1 AND status.system_code = $2 ORDER BY status.id`, [emailFromToken, status])
    const result = await pool.query(`UPDATE tasks SET status_id = $1 WHERE id = $2 RETURNING *`, [user.rows[0].id, id]);
    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    if (status === 'завершение') {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const finalDeadline = `${year}-${month}-${day}`;
      await pool.query(`UPDATE tasks SET final_deadline = $1 WHERE id = $2`, [finalDeadline, id]);
      await pool.query(`UPDATE stages SET final_deadline = $1 WHERE task_id = $2`, [finalDeadline, id]);    
    }
    await pool.query('COMMIT');
    res.json({ res: result.rows });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка изменения типов повторений' });
  }
});
app.get('/api/tasks_name/', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    const result = await pool.query('SELECT tasks.*, projects.color FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id LEFT JOIN users ON projects.users_id = users.id LEFT JOIN status ON tasks.status_id = status.id LEFT JOIN dates_tasks ON dates_tasks.task_id = tasks.id WHERE users.email = $1 AND status.system_code = $2 AND dates_tasks.id IS NOT NULL GROUP BY tasks.id, projects.color', [emailFromToken, 'работа']);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Задачи не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах' });
  }
});
app.post('/api/pomodoro_add/', async (req, res) => {
  let userEmail;
  try { 
    const decoded = jwt.verify(req.headers.authorization?.split(' ')[1], process.env.JWT_SECRET, { ignoreExpiration: true });
    userEmail = decoded.email;
  } catch (error) {
    return res.status(401).json({ error: 'Неверный токен' });
  }
  const { task_id, stage_id, pomodoro_date, start_time, end_time, duration, was_interrupted } = req.body;
  const result = await pool.query('SELECT id FROM users WHERE email = $1', [userEmail]);
  const users_id = result.rows[0]?.id;
  if ((!task_id && task_id != 0) || (!stage_id && stage_id != 0) || !pomodoro_date || !start_time || !end_time || !duration) {
    return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  try { 
    await pool.query('BEGIN');
    const result = await pool.query(`INSERT INTO pomodoro (task_id, stage_id, pomodoro_date, start_time, end_time, duration, was_interrupted, users_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [task_id, stage_id, pomodoro_date, start_time, end_time, duration, was_interrupted, users_id]);
    if (task_id === 0) {
      await pool.query('COMMIT');
      return res.json(result.rows[0]);      
    }
    if (stage_id === 0) {
        const count = await pool.query('SELECT pomodoros_spent FROM tasks WHERE id = $1', [task_id]);
        if (count.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ error: 'Ошибка получения количества помидоров' });
        }
        await pool.query(`UPDATE tasks SET pomodoros_spent = $1 WHERE id = $2`,[count.rows[0].pomodoros_spent + 1, task_id]);
        await pool.query('COMMIT');
        res.json(result.rows[0]);       
    }
        const count = await pool.query('SELECT pomodoros_spent FROM stages WHERE id = $1', [stage_id]);
        if (count.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ error: 'Ошибка получения количества помидоров этапа' });
        }
        await pool.query(`UPDATE stages SET pomodoros_spent = $1 WHERE id = $2`,[count.rows[0].pomodoros_spent + 1, stage_id]);
        await pool.query('COMMIT');
        res.json(result.rows[0]);    
  } catch (err) {
    await pool.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Ошибка добавления помодоро' });
  }
});




app.get('/api/pomodoro', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT pomodoro.*, users.email FROM pomodoro LEFT JOIN users ON pomodoro.users_id = users.id ORDER BY pomodoro.pomodoro_date';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сроки помодоро не найдены' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о сроках помодоро' });
  }
});
app.get('/api/export_date_from_pomodoro_history', authMiddleware, async (req, res) => {
  try {
    let query;
    query = 'SELECT MAX(pomodoro_date) as last_export_date FROM pomodoro_history';
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Дата последней выгрузки сроков помодоро не найдена' });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о последней выгрузке сроков помодоро' });
  }
});
app.post('/api/pomodoro_history_add', authMiddleware, async (req, res) => {
  const { dateInput } = req.body;
  if (!dateInput) {
      return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  try {
    await pool.query('BEGIN');
    const datesTasks = await pool.query(`SELECT * FROM pomodoro WHERE pomodoro_date BETWEEN 
      (SELECT MIN(pomodoro_date) FROM pomodoro) AND $1 ORDER BY pomodoro_date ASC;`, [dateInput]);
    if (datesTasks.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Нет данных для переноса за указанный период' });
    }
   for (const row of datesTasks.rows) {
      await pool.query(`INSERT INTO pomodoro_history (pomodoro_id, task_id, pomodoro_date, start_time, end_time, duration, was_interrupted, users_id ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [row.id, row.task_id, row.pomodoro_date, row.start_time, row.end_time, row.duration, row.was_interrupted,
        row.users_id]);
    }
    await pool.query(`DELETE FROM pomodoro WHERE pomodoro_date BETWEEN (SELECT MIN(pomodoro_date) FROM pomodoro) AND $1`, [dateInput]);
    await pool.query('COMMIT');
    res.json({message: `Успешно перенесены записи`});
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Ошибка выгрузки данных в таблицу Сроков помодоро' });
  }
});


app.get('/api/stages/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { execution_date } = req.query;
    let query;
    query = 'SELECT stages.stage_name, stages.description, stages.order_stage_in_list, dates_stages.*, execution_status.exec_status_name, execution_status.code, execution_status.exec_color FROM stages LEFT JOIN dates_stages ON stages.id = dates_stages.stage_id LEFT JOIN execution_status ON dates_stages.exec_status_id = execution_status.id WHERE task_id = $1 AND execution_date = $2 ORDER BY stages.order_stage_in_list';
    const result = await pool.query(query, [id, execution_date]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о этапах задачи' });
  }
});
app.post('/api/stage_add/', authMiddleware, async (req, res) => {
  const { id, formData } = req.body;
  if (!formData.stage_name || !formData.description) {
    return res.status(400).json({ error: 'Все поля должны быть заполнены перед добавлением' });
  }
  const date = new Date();
  try {
    await pool.query('BEGIN');
    const number = await pool.query(`SELECT MAX(order_stage_in_list) as max_count FROM stages WHERE task_id = $1`, [id])
    let count = 1;
    if (number.rows.length > 0 && number.rows[0].max_count !== null) {
      count = Number(number.rows[0].max_count) + 1;
    }   
    const task = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id])
    if (task.rows.length === 0){
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не найдена' });
    }     
    const dates = await pool.query(`SELECT * FROM dates_tasks WHERE task_id = $1 ORDER BY execution_date`, [id])
    if (dates.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Не найдены даты выполнения для задачи' });
    }
      const result = await pool.query(
        `INSERT INTO stages (task_id, stage_name, description, deadline, pomodoros_planned, final_deadline, pomodoros_spent, created_at, order_stage_in_list) 
         VALUES ($1, $2, $3, $4, -1, '1900-01-01', 0, $5, $6) RETURNING id`,
        [id, formData.stage_name, formData.description, task.rows[0].deadline, date, count]
      );
      const status = await pool.query(`select * from execution_status where code = $1`, ['ожидание'])
    for (const date of dates.rows)
      await pool.query(
        `INSERT INTO dates_stages (stage_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
        VALUES ($1, $2, $3, $4, '00:00:00', '00:00:00', $5) RETURNING id`,
        [result.rows[0].id, date.execution_date, date.planned_start_time, date.planned_end_time, status.rows[0].id]
      );
    await pool.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления этапа: Введено слишком длинное значение' });
      else 
        res.status(500).json({ error: 'Ошибка добавления этапа' });
  }
});
app.put('/api/stage_order_put/', authMiddleware, async (req, res) => {
  const { stages } = req.body;
  try {
    await pool.query('BEGIN');
    for (const stage of stages) {
      await pool.query(
        `UPDATE stages SET order_stage_in_list = $1 WHERE id = $2`,
        [stage.order_stage_in_list, stage.id]
      );
    }
    await pool.query('COMMIT');
    res.json({ success: true });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка изменения типов повторений' });
  }
});

app.get('/api/info_stage/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { execution_date } = req.query;
    let query;
    query = `SELECT tasks.task_name, status.status_name, stages.*, dates_tasks.exec_status_id as task_exec_status_id,
    dates_stages.execution_date, dates_stages.planned_start_time, dates_stages.planned_end_time, 
    dates_stages.actual_start_time, dates_stages.actual_end_time, dates_stages.exec_status_id, 
    dates_stages.id as dates_stages_id, status.system_code, settings.start_working_day, settings.end_working_day, 
    es_tasks.code as task_code, es_tasks.exec_status_name as task_exec_status_name, es_tasks.exec_color as task_exec_color,
    es_stages.code as stage_code, es_stages.exec_status_name as stage_exec_status_name, es_stages.exec_color as stage_exec_color FROM stages 
    LEFT JOIN tasks ON tasks.id = stages.task_id
    LEFT JOIN dates_tasks ON dates_tasks.task_id = tasks.id
    LEFT JOIN dates_stages ON dates_stages.stage_id = stages.id
    LEFT JOIN status ON status.id = tasks.status_id 
    LEFT JOIN execution_status es_tasks ON dates_tasks.exec_status_id = es_tasks.id
    LEFT JOIN execution_status es_stages ON dates_stages.exec_status_id = es_stages.id
    LEFT JOIN settings ON settings.users_id = status.users_id WHERE stages.id = $1 AND dates_stages.execution_date = $2 
    AND dates_tasks.execution_date = $3`;
    const result = await pool.query(query, [id, execution_date, execution_date]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задаче' });
  }
});
app.put('/api/stage_put/:id',  authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { value, field } = req.body;
  if (!value) {
      return res.status(400).json({ error: 'Значение поля должно быть заполнено перед добавлением' });
  }
  try {
      const result = await pool.query(`UPDATE stages SET ${field} = $1 WHERE id = $2 RETURNING *`, [value, id]);
      res.json({ stage: result.rows[0] });
  } catch (err) {
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка изменения: Введено слишком длинное значение' });
      else 
      res.status(500).json({ error: 'Ошибка изменения этапа' });
  }
});
app.put('/api/dates_stages_put_for_stage/',  authMiddleware, async (req, res) => {
  const { formData } = req.body;
  if (!formData.planned_start_time || !formData.planned_end_time) {
      return res.status(400).json({ error: 'Значение поля должно быть заполнено перед добавлением' });
  }
  try {
    const exec_status = await pool.query(`SELECT * FROM execution_status`)
      const findExecStatusIdByCode = (code) => {
        const st = exec_status.rows.find(s => s.code === code);
        return st ? st.id : null;
      };
    const result = await pool.query(`UPDATE dates_stages SET execution_date = $1, planned_start_time = $2, planned_end_time = $3, actual_start_time = $4, actual_end_time = $5, exec_status_id = $6 WHERE id = $7 RETURNING *`,
      [formData.execution_date, formData.planned_start_time, formData.planned_end_time, formData.actual_start_time, formData.actual_end_time, findExecStatusIdByCode(formData.code), formData.dates_stages_id]);
    if (result.rows.length === 0)
      return res.status(400).json({ error: 'Ошибка изменения срока этапа' });
    res.json(result.rows[0]);
  } catch (err) {
      console.error(err); 
      res.status(500).json({ error: 'Ошибка изменения срока этапа' });
  }
});


app.post('/api/task_copy/', authMiddleware, async (req, res) => {
  const { project_id, taskId } = req.body;
  const emailFromToken = req.userEmail;
  if (!project_id || !taskId) {
    return res.status(400).json({ error: 'ID не было получено' });
  }
  try {
    await pool.query('BEGIN');
    const task = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId])
    if (task.rows.length === 0){
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не найдена' });
    }
    const dates_tasks = await pool.query(`SELECT * FROM dates_tasks WHERE task_id = $1 ORDER BY execution_date`, [taskId])
    if (dates_tasks.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Не найдены даты выполнения для задачи' });
    }
    const stages = await pool.query(`SELECT * FROM stages WHERE task_id = $1`, [taskId])
    let dates_stages;
    if (stages.rows.length !== 0) {
      dates_stages = await pool.query(`SELECT dates_stages.* FROM dates_stages LEFT JOIN stages ON dates_stages.stage_id = stages.id WHERE stages.task_id = $1 ORDER BY execution_date`, [taskId])
      if (dates_stages.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'Не найдены даты выполнения для задачи' });
      }
    }  
    const status = await pool.query(`SELECT status.* FROM status LEFT JOIN users ON status.users_id = users.id WHERE users.email = $1`, [emailFromToken])
    const findStatusIdByCode = (systemCode) => {
      const st = status.rows.find(s => s.system_code === systemCode);
      return st ? st.id : null;
    };
    let new_status_id;
    if (task.rows[0].status_id === findStatusIdByCode('завершение'))
      new_status_id = findStatusIdByCode('ожидание');
    else
      new_status_id = task.rows[0].status_id;
      const now = new Date();
      const resultTask = await pool.query(
        `INSERT INTO tasks (project_id, task_name, description, status_id, matrix_id, deadline, pomodoros_planned, final_deadline, pomodoros_spent, created_at, repeat_type_id, number_repeat) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, '1900-01-01', $8, $9, $10, $11) RETURNING id`,
        [project_id, task.rows[0].task_name, task.rows[0].description, new_status_id, task.rows[0].matrix_id, task.rows[0].deadline, task.rows[0].pomodoros_planned, task.rows[0].pomodoros_spent, now, task.rows[0].repeat_type_id, task.rows[0].number_repeat]
      );
      const exec_status = await pool.query(`SELECT * FROM execution_status`)
      const findExecStatusIdByCode = (code) => {
        const st = exec_status.rows.find(s => s.code === code);
        return st ? st.id : null;
      };
    const allCompleted = dates_tasks.rows.every(row => row.exec_status_id === findExecStatusIdByCode('выполнение'));
    if (allCompleted)
          for (const date of dates_tasks.rows) {
            await pool.query(
              `INSERT INTO dates_tasks (task_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
              VALUES ($1, $2, $3, $4, '00:00:00', '00:00:00', $5) RETURNING id`,
              [resultTask.rows[0].id, date.execution_date,  date.planned_start_time, date.planned_end_time, findExecStatusIdByCode('ожидание')]
            );    
          }
    else
          for (const date of dates_tasks.rows) {
            await pool.query(
              `INSERT INTO dates_tasks (task_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
              VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [resultTask.rows[0].id, date.execution_date,  date.planned_start_time, date.planned_end_time, date.actual_start_time, date.actual_end_time, date.exec_status_id]
            );    
          }    
      if (stages.rows.length !== 0) {
        for (const stage of stages.rows) {
          let stage_id = await pool.query(
            `INSERT INTO stages (task_id, stage_name, description, deadline, pomodoros_planned, final_deadline, pomodoros_spent, created_at, order_stage_in_list) 
            VALUES ($1, $2, $3, $4, $5, '1900-01-01', $6, $7, $8) RETURNING id`,
            [resultTask.rows[0].id, stage.stage_name, stage.description, stage.deadline, stage.pomodoros_planned, stage.pomodoros_spent, now, stage.order_stage_in_list]
          );
            for (const date of dates_stages.rows)
              if (stage.id === date.stage_id)
                if (allCompleted)
                          await pool.query(
                            `INSERT INTO dates_stages (stage_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
                            VALUES ($1, $2, $3, $4, '00:00:00', '00:00:00', $5) RETURNING id`,
                            [stage_id.rows[0].id, date.execution_date,  date.planned_start_time, date.planned_end_time, findExecStatusIdByCode('ожидание')]
                          );
                else
                          await pool.query(
                            `INSERT INTO dates_stages (stage_id, execution_date,  planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                            [stage_id.rows[0].id, date.execution_date,  date.planned_start_time, date.planned_end_time, date.actual_start_time, date.actual_end_time, date.exec_status_id]
                          );
        }
    }
    await pool.query('COMMIT');
    res.json(resultTask.rows[0]);
  } catch (err) {
      await pool.query('ROLLBACK');
      console.error(err);
      if (err.message.includes('значение не умещается в тип'))
        res.status(500).json({ error: 'Ошибка добавления этапа: Введено слишком длинное значение' });
      else 
        res.status(500).json({ error: 'Ошибка добавления этапа' });
  }
});

app.delete('/api/stage_delete/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('BEGIN');
      const exists = await pool.query('SELECT * FROM stages WHERE id = $1', [id]);
      if (exists.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Этап не найден' });
      }
      const existsDate = await pool.query('SELECT * FROM dates_stages WHERE stage_id = $1', [id]);
      if (existsDate.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Сроки этапа не найдены' });
      }      
      await pool.query('DELETE FROM dates_stages WHERE stage_id = $1', [id]);
      await pool.query('DELETE FROM stages WHERE id = $1', [id]);   
      await pool.query('COMMIT');
      res.json({ message: 'Этап удален' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении этапа' });
  }
});
app.delete('/api/task_delete/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('BEGIN');
      const existsTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
      if (existsTask.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Задача не найдена' });
      }
      const existsDateTask = await pool.query('SELECT * FROM dates_tasks WHERE task_id = $1', [id]);
      if (existsDateTask.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Сроки задачи не найдены' });
      }        
      const exists = await pool.query('SELECT * FROM stages WHERE task_id = $1', [id]);
      if (exists.rows.length !== 0) {
      await pool.query(`DELETE FROM dates_stages WHERE stage_id IN (select id from stages WHERE task_id = $1)`, [id]);
      await pool.query('DELETE FROM stages WHERE task_id = $1', [id]); 
      }  
      await pool.query('DELETE FROM dates_tasks WHERE task_id = $1', [id]);
      await pool.query('DELETE FROM tasks WHERE id = $1', [id]);          
      await pool.query('COMMIT');
      res.json({ message: 'Задача удалена' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении задачи' });
  }
});
app.get('/api/get_tasks_time_pomodoro', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  const { date } = req.query;
  try {
    let query;
    query = `
      SELECT
        tasks.task_name,
        tasks.id as task_id,
        tasks.pomodoros_planned as tasks_pomodoros_planned, tasks.pomodoros_spent as tasks_pomodoros_spent,
        stages.pomodoros_planned as stages_pomodoros_planned, stages.pomodoros_spent as stages_pomodoros_spent,
        projects.project_name,
        projects.id as project_id,
        status.system_code,
        status.status_name,
        stages.stage_name,
        stages.id as stage_id,
        dates_tasks.planned_start_time as tasks_start_time, dates_tasks.planned_end_time as tasks_end_time,
        dates_stages.planned_start_time as stages_start_time, dates_stages.planned_end_time as stages_end_time,
        es_tasks.code as task_code, es_tasks.exec_status_name as task_exec_status_name, es_tasks.exec_color as task_exec_color,
        es_stages.code as stage_code, es_stages.exec_status_name as stage_exec_status_name, es_stages.exec_color as stage_exec_color
        FROM tasks
        LEFT JOIN projects ON tasks.project_id = projects.id
        LEFT JOIN stages ON stages.task_id = tasks.id
        LEFT JOIN dates_tasks ON dates_tasks.task_id = tasks.id
        LEFT JOIN dates_stages ON dates_stages.stage_id = stages.id
        LEFT JOIN execution_status es_tasks ON dates_tasks.exec_status_id = es_tasks.id
        LEFT JOIN execution_status es_stages ON dates_stages.exec_status_id = es_stages.id
        LEFT JOIN users ON users.id = projects.users_id
        LEFT JOIN status ON status.id = tasks.status_id
        WHERE users.email = $1
          AND dates_tasks.execution_date = $2
          AND (dates_stages.execution_date = $2 OR dates_stages.execution_date IS NULL)
        ORDER BY dates_tasks.planned_start_time, tasks.id, stages.order_stage_in_list
    `;
    const result = await pool.query(query, [emailFromToken, date]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах проекта' });
  }
});
app.get('/api/get_PomodoroWithoutTasks', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  const { date } = req.query;
  try {
    let query_withoutTask = `SELECT COUNT(*) as count FROM pomodoro LEFT JOIN users ON pomodoro.users_id = users.id where users.email = $1 and pomodoro_date = $2 and task_id = 0`;
    const result_withoutTask = await pool.query(query_withoutTask, [emailFromToken, date]);
    let query_totalCount = `SELECT COUNT(*) as count FROM pomodoro LEFT JOIN users ON pomodoro.users_id = users.id where users.email = $1 and pomodoro_date = $2`;
    const result_totalCount = await pool.query(query_totalCount, [emailFromToken, date]); 
    let query_wasInterrupted = `SELECT COUNT(*) as count FROM pomodoro LEFT JOIN users ON pomodoro.users_id = users.id where users.email = $1 and pomodoro_date = $2 and was_interrupted = true`;
    const result_wasInterrupted = await pool.query(query_wasInterrupted, [emailFromToken, date]);        
    let query_grouped = `SELECT pomodoro.task_id, pomodoro.stage_id, COUNT(*) as count FROM pomodoro LEFT JOIN users ON pomodoro.users_id = users.id
        WHERE users.email = $1 AND pomodoro.pomodoro_date = $2 GROUP BY pomodoro.task_id, pomodoro.stage_id ORDER BY pomodoro.task_id, pomodoro.stage_id`;
    const result_grouped = await pool.query(query_grouped, [emailFromToken, date]);
    res.json({
      withoutTask_count: parseInt(result_withoutTask.rows[0].count) || 0,
      total_count: parseInt(result_totalCount.rows[0].count) || 0,
      interrupted_count: parseInt(result_wasInterrupted.rows[0].count) || 0,
      grouped: result_grouped.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации о задачах проекта' });
  }
});

app.get('/api/tasks_with_user', authMiddleware, async (req, res) => {
  try {
    const query = `
      SELECT 
        tasks.id,
        tasks.task_name,
        tasks.description,
        status.status_name,
        status.system_code,
        matrix.matrix_name,
        matrix.matrix_part,
        tasks.deadline,
        tasks.pomodoros_planned,
        tasks.final_deadline,
        tasks.pomodoros_spent,
        tasks.created_at,
        repeat_types.type_name as repeat_type_name,
        tasks.number_repeat,
        users.id as users_id,
        users.email,
        projects.id as project_id,
        projects.project_name,
        (SELECT MIN(execution_date) FROM dates_tasks WHERE task_id = tasks.id) as min_time_period_dates_tasks,
        (SELECT MAX(execution_date) FROM dates_tasks WHERE task_id = tasks.id) as max_time_period_dates_tasks,
        stages.id as stage_id,
        stages.stage_name,
        stages.description as stage_description,
        stages.deadline as stage_deadline,
        stages.pomodoros_planned as stage_pomodoros_planned,
        stages.final_deadline as stage_final_deadline,
        stages.pomodoros_spent as stage_pomodoros_spent,
        stages.created_at as stage_created_at,
        stages.order_stage_in_list,
        (SELECT MIN(execution_date) FROM dates_stages WHERE stage_id = stages.id) as min_time_period_dates_stages,
        (SELECT MAX(execution_date) FROM dates_stages WHERE stage_id = stages.id) as max_time_period_dates_stages
      FROM tasks
      LEFT JOIN projects ON tasks.project_id = projects.id
      LEFT JOIN users ON projects.users_id = users.id
      LEFT JOIN matrix ON tasks.matrix_id = matrix.id
      LEFT JOIN status ON tasks.status_id = status.id
      LEFT JOIN repeat_types ON tasks.repeat_type_id = repeat_types.id
      LEFT JOIN stages ON stages.task_id = tasks.id
      ORDER BY users.email, tasks.created_at DESC, stages.order_stage_in_list
    `;
    const result = await pool.query(query);
    if (result.rows.length === 0) {
      return res.json([]);
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка при получении задач с пользователями:', err);
    res.status(500).json({ error: 'Ошибка при получении задач' });
  }
});


app.get('/api/stages_pomodoro/', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
    const result = await pool.query('SELECT stages.* FROM stages LEFT JOIN tasks ON stages.task_id = tasks.id LEFT JOIN projects ON projects.id = tasks.project_id LEFT JOIN users ON projects.users_id = users.id LEFT JOIN status ON tasks.status_id = status.id WHERE users.email = $1 AND status.system_code = $2', [emailFromToken, 'работа']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении информации об этапах' });
  }
});





app.get('/api/tasks_for_gantt', authMiddleware, async (req, res) => {
  const emailFromToken = req.userEmail;
  try {
      const tasksQuery = `
          SELECT 
              tasks.id as task_id,
              tasks.task_name,
              tasks.deadline,
              tasks.created_at,
              tasks.pomodoros_planned,
              tasks.pomodoros_spent,
              tasks.status_id,
              status.status_name,
              status.system_code,
              projects.id as project_id,
              projects.project_name,
              projects.color as project_color,
              (SELECT MIN(execution_date) FROM dates_tasks WHERE dates_tasks.task_id = tasks.id) as min_time_period_dates_tasks
          FROM tasks
          LEFT JOIN projects ON tasks.project_id = projects.id
          LEFT JOIN users ON projects.users_id = users.id
          LEFT JOIN status ON tasks.status_id = status.id
          WHERE users.email = $1 AND EXISTS (SELECT 1 FROM dates_tasks WHERE dates_tasks.task_id = tasks.id)
          ORDER BY projects.project_name, tasks.deadline, tasks.created_at
      `;
      
      const tasksResult = await pool.query(tasksQuery, [emailFromToken]);

      const executionsQuery = `
          SELECT 
            dates_tasks.task_id,
            dates_tasks.execution_date,
            execution_status.code as code,
            execution_status.exec_status_name as name,
            execution_status.exec_color
          FROM dates_tasks
          LEFT JOIN execution_status ON dates_tasks.exec_status_id = execution_status.id
          LEFT JOIN tasks ON dates_tasks.task_id = tasks.id
          LEFT JOIN projects ON tasks.project_id = projects.id
          LEFT JOIN users ON projects.users_id = users.id
          WHERE users.email = $1
          ORDER BY dates_tasks.execution_date
      `; 
      const executionsResult = await pool.query(executionsQuery, [emailFromToken]);
      const stagesQuery = `
          SELECT 
            stages.id as stage_id,
            stages.task_id,
            stages.stage_name,
            stages.deadline as stage_deadline,
            stages.order_stage_in_list,
            stages.created_at as stage_created_at
          FROM stages
          LEFT JOIN tasks ON stages.task_id = tasks.id
          LEFT JOIN projects ON tasks.project_id = projects.id
          LEFT JOIN users ON projects.users_id = users.id
          WHERE users.email = $1
          ORDER BY stages.task_id, stages.order_stage_in_list
      `;
      const stagesResult = await pool.query(stagesQuery, [emailFromToken]); 
      const stageExecutionsQuery = `
          SELECT 
            dates_stages.stage_id,
            dates_stages.execution_date,
            execution_status.code as code,
            execution_status.exec_status_name as name,
            execution_status.exec_color
          FROM dates_stages
          LEFT JOIN execution_status ON dates_stages.exec_status_id = execution_status.id
          LEFT JOIN stages ON dates_stages.stage_id = stages.id
          LEFT JOIN tasks ON stages.task_id = tasks.id
          LEFT JOIN projects ON tasks.project_id = projects.id
          LEFT JOIN users ON projects.users_id = users.id
          WHERE users.email = $1
          ORDER BY dates_stages.execution_date
      `;
      const stageExecutionsResult = await pool.query(stageExecutionsQuery, [emailFromToken]);
      const tasksMap = {};
      tasksResult.rows.forEach(task => {
          tasksMap[task.task_id] = {...task, executions: [], stages: []};
      });
      executionsResult.rows.forEach(exec => {
          if (tasksMap[exec.task_id])
              tasksMap[exec.task_id].executions.push({execution_date: exec.execution_date, code: exec.code, name: exec.name, exec_color: exec.exec_color});
      });
      const stagesMap = {};
      stagesResult.rows.forEach(stage => {
          stagesMap[stage.stage_id] = stage;
          if (tasksMap[stage.task_id])
              tasksMap[stage.task_id].stages.push({...stage, executions: []});
      });
      stageExecutionsResult.rows.forEach(exec => {
          const stage = stagesMap[exec.stage_id];
          if (stage) {
              const task = tasksMap[stage.task_id];
              if (task) {
                  const taskStage = task.stages.find(s => s.stage_id === exec.stage_id);
                  if (taskStage)
                      taskStage.executions.push({execution_date: exec.execution_date, code: exec.code, name: exec.name, exec_color: exec.exec_color});
              }
          }
      });
      Object.values(tasksMap).forEach(task => {task.stages.sort((a, b) => (a.order_stage_in_list || 0) - (b.order_stage_in_list || 0));});
      res.json(Object.values(tasksMap));
  } catch (err) {
      console.error('Ошибка при получении данных для Ганта:', err);
      res.status(500).json({ error: 'Ошибка при получении данных' });
  }
});
app.get('/', (req, res) => {
  res.send('Backend работает!');
});
async function checkMainAdmin() {
  const result = await pool.query(`SELECT id FROM users WHERE note = 'Администратор системы'`);
  
  if (result.rows.length === 0) {
      console.error('\x1b[31mОШИБКА: Нет главного администратора!\x1b[0m');
      console.error('Выполните: UPDATE users SET note = \'Администратор системы\' WHERE id = ...');
      process.exit(1);
  }
  
  if (result.rows.length > 1) {
      console.error(`\x1b[31mОШИБКА: Найдено ${result.rows.length} главных администраторов!\x1b[0m`);
      console.error('Должен быть только один пользователь с note = "Администратор системы"');
      console.error('Выполните: UPDATE users SET note = \'\' WHERE note = \'Администратор системы\' AND id != ...');
      process.exit(1);
  }
  
  console.log(`\x1b[32m✓ Главный администратор: ${result.rows[0].username}\x1b[0m`);
}

// Запуск с проверкой
async function start() {
  try {
      await pool.query('SELECT NOW()');
      const result = await pool.query(`SELECT role_name, email FROM users WHERE note = 'Администратор системы'`);
      if (result.rows.length === 0) {
        console.error('\x1b[31mОШИБКА: Нет главного администратора!\x1b[0m');
        console.error('Выполните: UPDATE users SET note = \'Администратор системы\' WHERE role_name = \'admin\' AND id = ...');
        process.exit(1);
    }
    if (result.rows.length > 1) {
        console.error(`\x1b[31mОШИБКА: Найдено ${result.rows.length} главных администраторов!\x1b[0m`);
        console.error('Должен быть только один пользователь с note = "Администратор системы" и role_name = \'admin\'');
        process.exit(1);
    }
    if (result.rows[0].role_name !== 'admin') {
        console.error(`\x1b[31mОШИБКА: Главный администратор не является администратором!\x1b[0m`);
        console.error('Должен быть только один пользователь с note = "Администратор системы" и role_name = \'admin\'');
        process.exit(1);
    }
    console.log(`Главный администратор приложения: ${result.rows[0].email}`);
      app.listen(PORT, () => {
          console.log(`Сервер запущен на http://localhost:${PORT}`);
      });
  } catch (err) {
      console.error('Ошибка:', err.message);
      process.exit(1);
  }
}

start();
