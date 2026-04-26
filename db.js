import pg from 'pg';
import dotenv from 'dotenv';

// Загружаем переменные окружения из .env
dotenv.config();

// Настройки подключения к PostgreSQL
const { Pool } = pg;
const pool = new Pool({
    database: 'postgres',
    host: process.env["DB_HOST"],
    password: process.env["DB_PASSWORD"],
    port: process.env["DB_PORT"],
    user: process.env["DB_USER"],
});

// Функция для выполнения SQL-запросов
async function runQuery(client, query, values = []) {
    try {
        return await client.query(query, values);
    } catch (error) {
        console.error('Ошибка при выполнении запроса:', error);
        throw error;
    }
}

// Функция для выполнения SQL-запросов
async function runQueries() {
    const client = await pool.connect();
    try {
        console.log('Создание базы данных...');

        await runQuery(client, `
        CREATE DATABASE ${process.env["DB_NAME"]};
        `)

        console.log('База данных успешно создана.');
    } catch (error) {
        console.error('Ошибка при создании базы данных:', error);
        return;
    } finally {
        client.release();
        await pool.end();
    }

    // Подключаемся к новой базе данных
    const newPool = new Pool({
        user: process.env["DB_USER"],
        host: process.env["DB_HOST"],
        database: process.env["DB_NAME"],
        password: process.env["DB_PASSWORD"],
        port: process.env["DB_PORT"],
    });
    const newClient = await newPool.connect();
    try {
        console.log("Создание и заполнение таблиц...")

        // Создание таблицы users
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                first_name VARCHAR(50) NOT NULL,
                last_name VARCHAR(50) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role_name VARCHAR(50) NOT NULL,
                birthday DATE NOT NULL,
                phone_number VARCHAR(20) NOT NULL,
                note TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_password_change_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await runQuery(newClient, `
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
        `);

        // Заполнение таблицы users
        await runQuery(newClient, `
            INSERT INTO users (first_name, last_name, email, password, role_name, birthday, phone_number, note) VALUES
            ('Администратор', 'системы', 'admin@example.com', crypt('admin123', gen_salt('bf')), 'admin', '2004-03-15', '9991234567', 'Администратор системы'),
            ('Мария', 'Петрова', 'maria@example.com', crypt('user456', gen_salt('bf')), 'user', '2007-07-22', '9992345678', 'Не откладывай на завтра то, что можно сделать сегодня!'),
            ('Дмитрий', 'Сидоров', 'dmitry@example.com', crypt('pass789', gen_salt('bf')), 'user', '2002-11-30', '9993456789', 'Каждая решенная задача - шаг к цели'),
            ('Елена', 'Кузнецова', 'elena@example.com', crypt('elenka01', gen_salt('bf')), 'user', '2001-05-18', '9994567890', 'Порядок в задачах - порядок в мыслях'),
            ('Сергей', 'Васильев', 'sergey@example.com', crypt('vasiliev!', gen_salt('bf')), 'user', '2006-09-10', '9995678901', 'Начинаю свой путь к организованности');
        `);

       // Создание таблицы settings
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS settings (
                users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
                limit_tasks INTEGER NOT NULL,
                pomodoro_duration INTEGER NOT NULL,                
                start_working_day TIME NOT NULL,
                end_working_day TIME NOT NULL,
                number_pomodoro_per_day INTEGER NOT NULL,
                rest_duration INTEGER NOT NULL
            );
        `);

        // Заполнение таблицы settings
        await runQuery(newClient, `
            INSERT INTO settings (users_id, limit_tasks, pomodoro_duration, start_working_day, end_working_day, number_pomodoro_per_day, rest_duration) VALUES
            (1, 6, 30, '09:00:00', '18:00:00', 12, 15),
            (2, 7, 25, '09:30:00', '18:30:00', 8, 25),
            (3, 5, 30, '07:00:00', '16:00:00', 5, 45),
            (4, 8, 20, '10:00:00', '19:00:00', 5, 20),
            (5, 6, 30, '08:00:00', '20:00:00', 8, 25);
        `);

        // Создание таблицы matrix
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS matrix (
                id SERIAL PRIMARY KEY,
                users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                matrix_part INTEGER NOT NULL CHECK (matrix_part BETWEEN 1 AND 4),
                matrix_name VARCHAR(50) NOT NULL,
                description TEXT NOT NULL,
                color VARCHAR(20) NOT NULL
            );
        `);

        // Заполнение таблицы matrix
        await runQuery(newClient, `
            INSERT INTO matrix (users_id, matrix_part, matrix_name, description, color) VALUES
            (1, 1, 'Срочно и важно', 'Важные задачи, требующие немедленного внимания', '#FF6B6B'),
            (1, 2, 'Важно, но не срочно', 'Важные задачи, которые можно отложить', '#4ECDC4'),
            (1, 3, 'Срочно, но не важно', 'Задачи, требующие немедленного внимания', '#FFD166'),
            (1, 4, 'Не срочно и не важно', 'Малозначимые задачи', '#A0A0A0'),
            (2, 1, 'Срочно и важно', 'Дедлайны, проблемы, кризисы', '#FF5252'),
            (2, 2, 'Важно, но не срочно', 'Планы на будущее, саморазвитие', '#00BCD4'),
            (2, 3, 'Срочно, но не важно', 'Неважные звонки, некоторые письма', '#FFC107'),
            (2, 4, 'Не срочно и не важно', 'Соцсети, развлечения', '#9E9E9E'),
            (3, 1, 'Срочно и важно', 'Требуют действий прямо сейчас', '#E53935'),
            (3, 2, 'Важно, но не срочно', 'Качество жизни, здоровье, отношения', '#00897B'),
            (3, 3, 'Срочно, но не важно', 'Встречи по требованию других', '#FFB300'),
            (3, 4, 'Не срочно и не важно', 'Бесполезные активности', '#757575'),
            (4, 1, 'Срочно и важно', 'Нельзя откладывать, нужно сделать сегодня', '#FF6B6B'),
            (4, 2, 'Важно, но не срочно', 'Можно сделать завтра или позже', '#4ECDC4'),
            (4, 3, 'Срочно, но не важно', 'Можно делегировать или сделать быстро', '#FFD166'),
            (4, 4, 'Не срочно и не важно', 'Можно вообще не делать, развлечения', '#A0A0A0'),
            (5, 1, 'Срочно и важно', 'Высокая важность + срочность, делаем первыми', '#E74C3C'),
            (5, 2, 'Важно, но не срочно', 'Важно для роста, но есть время на выполнение', '#3498DB'),
            (5, 3, 'Срочно, но не важно', 'Срочные мелочи, можно делегировать', '#F39C12'),
            (5, 4, 'Не срочно и не важно', 'Мусорные задачи, отвлекающие факторы', '#95A5A6');
        `);

        // Создание таблицы projects        
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                project_name VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                color VARCHAR(20) NOT NULL DEFAULT '#3B82F6',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Заполнение таблицы projects
        await runQuery(newClient, `
            INSERT INTO projects (users_id, project_name, description, color, is_active) VALUES
            (1, 'Системный', 'Проект по умолчанию для администратора', '#4F46E5', TRUE),
            (2, 'Курсовой проект', 'Разработка веб-приложения для курсовой работы', '#8B5CF6', TRUE),
            (2, 'Стажировка в IT', 'Прохождение стажировки в компании Яндекс', '#06B6D4', TRUE),
            (2, 'Портфолио GitHub', 'Наполнение GitHub интересными проектами', '#F59E0B', TRUE),
            (3, 'Исследовательская работа', 'Научное исследование по машинному обучению', '#EC4899', TRUE),
            (3, 'Онлайн-курсы', 'Прохождение курсов на Coursera и Stepik', '#6366F1', TRUE),
            (3, 'Волонтерство', 'Участие в волонтерских проектах университета', '#84CC16', TRUE),
            (4, 'Программирование на Python', 'Изучение продвинутого Python и фреймворков', '#F97316', TRUE),
            (4, 'Бюджет студента', 'Ведение личного бюджета и финансовое планирование', '#14B8A6', TRUE),
            (4, 'Книжный вызов', 'Прочитать 20 книг по саморазвитию за семестр', '#8B5CF6', TRUE),
            (5, 'Разработка мобильного приложения', 'Создание приложения для учета личных финансов', '#0EA5E9', TRUE),
            (5, 'Научная публикация', 'Подготовка статьи для студенческой конференции', '#10B981', TRUE),
            (5, 'Подготовка к олимпиаде', 'Решение задач для участия в программистской олимпиаде', '#F59E0B', TRUE);
        `);

        // Создание таблицы status
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS status (
                id SERIAL PRIMARY KEY,
                status_name VARCHAR(50) NOT NULL,
                users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                system_code VARCHAR(20) NOT NULL
             );
        `);

        // Заполнение таблицы status
        await runQuery(newClient, `
            INSERT INTO status (status_name, users_id, system_code) VALUES
            ('Ожидает начала', 1, 'ожидание'),
            ('В работе', 1, 'работа'),
            ('Приостановлена', 1, 'остановка'),
            ('Завершена', 1, 'завершение'),
            ('Запланировано', 2, 'ожидание'),
            ('Пишу код', 2, 'работа'),
            ('На ревью', 2, 'остановка'),
            ('Сдано', 2, 'завершение'),
            ('В очереди', 3, 'ожидание'),
            ('Эксперимент', 3, 'работа'),
            ('Жду данные', 3, 'остановка'),
            ('Опубликовано', 3, 'завершение'),
            ('Идея', 4, 'ожидание'),
            ('Организация', 4, 'работа'),
            ('На паузе', 4, 'остановка'),
            ('Проведено', 4, 'завершение'),
            ('В расписании', 5, 'ожидание'),
            ('Тренировка', 5, 'работа'),
            ('Перенесено', 5, 'остановка'),
            ('Достигнуто', 5, 'завершение');
        `);

        // Создание таблицы execution_status
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS execution_status (
                id SERIAL PRIMARY KEY,
                exec_status_name VARCHAR(50) NOT NULL,
                code VARCHAR(20) NOT NULL,
                exec_color VARCHAR(20) NOT NULL
            );
        `);
        // Заполнение таблицы execution_status
        await runQuery(newClient, `
            INSERT INTO execution_status (id, exec_status_name, code, exec_color) VALUES
            (1, 'Не начата', 'ожидание', '#696969'),
            (2, 'В работе', 'работа', '#bec125'),
            (3, 'Выполнена', 'выполнение', '#3c55d3'),
            (4, 'Просрочена', 'просрочка', '#ec83a8'),
            (5, 'Отменена', 'отмена', '#ff0026');
        `);  

        // Создание таблицы repeat_types
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS repeat_types (
                id SERIAL PRIMARY KEY,
                type_name VARCHAR(200) NOT NULL,               
                description TEXT NOT NULL
            );
        `);

        // Заполнение таблицы repeat_types
        await runQuery(newClient, `
            INSERT INTO repeat_types (type_name, description) VALUES
            ('Без повторения', 'Одноразовая задача'),
            ('Ежедневно', 'Повторять каждый день'),
            ('Еженедельно', 'Повторять каждую неделю'),
            ('Ежемесячно', 'Повторять каждый месяц'),
            ('Раз в N дней', 'Повторять через указанное количество дней'),
            ('Ежегодно', 'Повторять каждый год');
        `);

        // Создание таблицы tasks
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_name VARCHAR(200) NOT NULL,
                description TEXT NOT NULL,
                status_id INTEGER NOT NULL REFERENCES status(id) ON DELETE RESTRICT,
                matrix_id INTEGER NOT NULL REFERENCES matrix(id) ON DELETE RESTRICT,
                deadline DATE NOT NULL DEFAULT '3000-01-01',
                pomodoros_planned INTEGER NOT NULL DEFAULT -1,
                final_deadline DATE NOT NULL DEFAULT '1900-01-01',
                pomodoros_spent INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                repeat_type_id INTEGER NOT NULL REFERENCES repeat_types(id) ON DELETE CASCADE,
                number_repeat INTEGER[] NOT NULL
            );
        `);

        // Заполнение таблицы tasks
        await runQuery(newClient, `
            INSERT INTO tasks (project_id, task_name, description, status_id, matrix_id, deadline, pomodoros_planned, repeat_type_id, number_repeat) VALUES
            (1, 'Системная задача', 'Задача по умолчанию', 2, 4, '2026-08-15', 10, 2, '{1}'),
            (2, 'Проектирование БД', 'Схема базы данных для курсовой', 5, 5, '2026-09-10', 8, 1, '{0}'),
            (2, 'Верстка интерфейса', 'HTML/CSS макеты страниц', 6, 6, '2026-09-20', 10, 1, '{0}'),
            (2, 'Написание кода', 'Основная логика приложения', 5, 5, '2026-09-25', 15, 3, '{2,4}'),
            (3, 'Изучение кода', 'Знакомство с кодбазой компании', 6, 6, '2026-08-20', 6, 2, '{1}'),
            (3, 'Исправление бага', 'Баги в системе авторизации', 6, 5, '2026-08-28', 5, 5, '{3}'),
            (3, 'Code review', 'Проверка 3 pull request', 7, 7, '2026-09-05', 4, 1, '{0}'),
            (4, 'Создание README', 'Документация для проекта', 5, 6, '2026-08-01', 2, 4, '{1,15}'), -- Ежемесячно 1 и 15 числа
            (4, 'Настройка CI/CD', 'Автоматическое тестирование', 6, 5, '2026-08-05', 6, 1, '{0}'),
            (4, 'Деплой проекта', 'Размещение на GitHub Pages', 5, 6, '2026-08-10', 3, 1, '{0}'),
            (5, 'Сбор датасета', 'Сбор данных для исследования', 9, 9, '2026-09-15', 10, 3, '{1}'),
            (5, 'Обучение модели', 'Обучение нейросети', 10, 10, '2026-09-25', 15, 2, '{1}'),
            (5, 'Анализ результатов', 'Анализ точности модели', 9, 10, '2026-10-05', 8, 4, '{10,20,30}'),
            (6, 'Лекции 1-3', 'Машинное обучение на Coursera', 10, 10, '2026-08-28', 6, 5, '{7}'),
            (6, 'Практические задачи', 'Задачи по линейной алгебре', 9, 9, '2026-09-05', 7, 3, '{3,6}'),
            (6, 'Финальный проект', 'Итоговый проект курса', 9, 9, '2026-09-15', 12, 1, '{0}'),
            (7, 'Организация сбора', 'Сбор команды для помощи приюту', 9, 10, '2026-08-01', 4, 1, '{0}'),
            (7, 'Закупка кормов', 'Покупка корма для животных', 10, 9, '2026-08-05', 2, 4, '{5}'),
            (7, 'Проведение мероприятия', 'День открытых дверей в приюте', 9, 10, '2026-08-10', 5, 1, '{0}'),
            (8, 'Изучение Django', 'Туториал по Django фреймворку', 13, 14, '2026-09-10', 10, 2, '{1}'),
            (8, 'Создание REST API', 'Разработка API для проекта', 13, 13, '2026-09-20', 8, 3, '{2,4,6}'),
            (8, 'Асинхронность', 'Изучение asyncio и aiohttp', 13, 14, '2026-09-30', 7, 5, '{2}'),
            (9, 'Учет расходов', 'Запись всех трат за август', 14, 14, '2026-09-05', 2, 4, '{28}'),
            (9, 'Анализ экономии', 'Поиск способов сократить расходы', 13, 14, '2026-09-10', 3, 1, '{0}'),
            (9, 'Планирование бюджета', 'Бюджет на сентябрь месяц', 13, 13, '2026-08-25', 2, 1, '{0}'),
            (10, 'Чтение книги', 'Атомные привычки - до конца', 14, 14, '2026-08-28', 5, 2, '{1}'),
            (10, 'Конспект главы', 'Ключевые идеи из книги', 13, 14, '2026-09-05', 2, 3, '{7}'),
            (10, 'Написание отзыва', 'Отзыв на книгу для блога', 13, 14, '2026-09-07', 3, 1, '{0}'),
            (11, 'Прототип в Figma', 'Создание макетов интерфейса', 17, 18, '2026-09-15', 7, 1, '{0}'),
            (11, 'Настройка Firebase', 'База данных и аутентификация', 18, 17, '2026-09-20', 5, 5, '{5}'),
            (11, 'Графики статистики', 'Добавление графиков расходов', 17, 18, '2026-09-25', 8, 3, '{1,3,5}'),
            (12, 'Поиск конференции', 'Поиск подходящей конференции', 17, 18, '2026-08-25', 2, 1, '{0}'),
            (12, 'Написание тезисов', 'Подготовка тезисов для подачи', 18, 17, '2026-09-05', 6, 4, '{15}'),
            (12, 'Подготовка доклада', 'Создание презентации', 17, 18, '2026-09-20', 5, 2, '{1}'),
            (13, 'Задачи на графы', 'Решение 10 задач на алгоритмы', 18, 17, '2026-09-01', 8, 3, '{4}'),
            (13, 'Динамическое программирование', 'Сложные задачи ДП', 17, 18, '2026-09-10', 10, 5, '{4}'),
            (13, 'Пробный тур', 'Прохождение пробного тура', 17, 17, '2026-09-20', 3, 6, '{1}');
        `);

        // Создание таблицы dates_tasks
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS dates_tasks (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                execution_date DATE NOT NULL,
                planned_start_time TIME NOT NULL DEFAULT '00:00:00',
                planned_end_time TIME NOT NULL DEFAULT '00:00:00',
                actual_start_time TIME NOT NULL DEFAULT '00:00:00',
                actual_end_time TIME NOT NULL DEFAULT '00:00:00',
                exec_status_id INTEGER NOT NULL REFERENCES execution_status(id) ON DELETE RESTRICT
            );
        `);

        // Заполнение таблицы dates_tasks
        await runQuery(newClient, `
            INSERT INTO dates_tasks (task_id, execution_date, planned_start_time, planned_end_time, exec_status_id) VALUES
            (1, '2026-08-05', '09:00:00', '11:00:00', 3),
            (1, '2026-08-10', '14:00:00', '16:00:00', 2),
            (1, '2026-08-12', '10:00:00', '12:00:00', 1),
            (2, '2026-08-20', '08:30:00', '10:30:00', 3),
            (2, '2026-08-27', '13:00:00', '15:00:00', 1),
            (2, '2026-09-05', '15:00:00', '17:00:00', 2),
            (3, '2026-09-01', '10:00:00', '12:00:00', 1),
            (3, '2026-09-08', '11:00:00', '13:00:00', 3),
            (3, '2026-09-15', '14:00:00', '16:00:00', 1),
            (4, '2026-09-10', '09:00:00', '11:00:00', 2),
            (4, '2026-09-15', '10:30:00', '12:30:00', 1),
            (4, '2026-09-20', '13:00:00', '15:00:00', 3),
            (5, '2026-08-05', '08:00:00', '10:00:00', 1),
            (5, '2026-08-10', '09:00:00', '11:00:00', 3),
            (5, '2026-08-15', '14:00:00', '16:00:00', 2),
            (6, '2026-08-15', '10:00:00', '12:00:00', 1),
            (6, '2026-08-20', '11:00:00', '13:00:00', 3),
            (6, '2026-08-25', '15:00:00', '17:00:00', 1),
            (7, '2026-08-22', '09:30:00', '11:30:00', 2),
            (7, '2026-08-29', '13:00:00', '15:00:00', 1),
            (7, '2026-09-02', '16:00:00', '18:00:00', 3),
            (8, '2026-07-25', '08:30:00', '10:30:00', 3),
            (8, '2026-07-28', '11:00:00', '13:00:00', 1),
            (8, '2026-07-30', '14:00:00', '16:00:00', 2),
            (9, '2026-07-29', '10:00:00', '12:00:00', 1),
            (9, '2026-08-01', '12:00:00', '14:00:00', 3),
            (9, '2026-08-03', '15:00:00', '17:00:00', 1),
            (10, '2026-08-02', '09:00:00', '11:00:00', 2),
            (10, '2026-08-05', '10:30:00', '12:30:00', 1),
            (10, '2026-08-08', '13:00:00', '15:00:00', 3),
            (11, '2026-09-01', '08:00:00', '10:00:00', 1),
            (11, '2026-09-05', '09:00:00', '11:00:00', 3),
            (11, '2026-09-10', '14:00:00', '16:00:00', 2),
            (12, '2026-09-10', '10:00:00', '12:00:00', 1),
            (12, '2026-09-15', '11:00:00', '13:00:00', 3),
            (12, '2026-09-20', '15:00:00', '17:00:00', 1),
            (13, '2026-09-20', '09:30:00', '11:30:00', 2),
            (13, '2026-09-25', '13:00:00', '15:00:00', 1),
            (13, '2026-09-30', '16:00:00', '18:00:00', 3),
            (14, '2026-08-15', '08:30:00', '10:30:00', 3),
            (14, '2026-08-20', '11:00:00', '13:00:00', 1),
            (14, '2026-08-25', '14:00:00', '16:00:00', 2),
            (15, '2026-08-25', '10:00:00', '12:00:00', 1),
            (15, '2026-08-30', '12:00:00', '14:00:00', 3),
            (15, '2026-09-02', '15:00:00', '17:00:00', 1),
            (16, '2026-09-03', '09:00:00', '11:00:00', 2),
            (16, '2026-09-08', '10:30:00', '12:30:00', 1),
            (16, '2026-09-12', '13:00:00', '15:00:00', 3),
            (17, '2026-07-20', '08:00:00', '10:00:00', 1),
            (17, '2026-07-25', '09:00:00', '11:00:00', 3),
            (17, '2026-07-28', '14:00:00', '16:00:00', 2),
            (18, '2026-07-30', '10:00:00', '12:00:00', 1),
            (18, '2026-08-02', '11:00:00', '13:00:00', 3),
            (18, '2026-08-04', '15:00:00', '17:00:00', 1),
            (19, '2026-08-03', '09:30:00', '11:30:00', 2),
            (19, '2026-08-05', '13:00:00', '15:00:00', 1),
            (19, '2026-08-08', '16:00:00', '18:00:00', 3),
            (20, '2026-08-25', '08:30:00', '10:30:00', 3),
            (20, '2026-09-01', '11:00:00', '13:00:00', 1),
            (20, '2026-09-05', '14:00:00', '16:00:00', 2),
            (21, '2026-09-05', '10:00:00', '12:00:00', 1),
            (21, '2026-09-10', '12:00:00', '14:00:00', 3),
            (21, '2026-09-15', '15:00:00', '17:00:00', 1),
            (22, '2026-09-15', '09:00:00', '11:00:00', 2),
            (22, '2026-09-20', '10:30:00', '12:30:00', 1),
            (22, '2026-09-25', '13:00:00', '15:00:00', 3),
            (23, '2026-08-20', '08:00:00', '10:00:00', 1),
            (23, '2026-08-25', '09:00:00', '11:00:00', 3),
            (23, '2026-08-30', '14:00:00', '16:00:00', 2),
            (24, '2026-09-01', '10:00:00', '12:00:00', 1),
            (24, '2026-09-04', '11:00:00', '13:00:00', 3),
            (24, '2026-09-07', '15:00:00', '17:00:00', 1),
            (25, '2026-08-10', '09:30:00', '11:30:00', 2),
            (25, '2026-08-15', '13:00:00', '15:00:00', 1),
            (25, '2026-08-20', '16:00:00', '18:00:00', 3),
            (26, '2026-08-15', '08:30:00', '10:30:00', 3),
            (26, '2026-08-20', '11:00:00', '13:00:00', 1),
            (26, '2026-08-25', '14:00:00', '16:00:00', 2),
            (27, '2026-08-25', '10:00:00', '12:00:00', 1),
            (27, '2026-08-30', '12:00:00', '14:00:00', 3),
            (27, '2026-09-04', '15:00:00', '17:00:00', 1),
            (28, '2026-09-03', '09:00:00', '11:00:00', 2),
            (28, '2026-09-08', '10:30:00', '12:30:00', 1),
            (28, '2026-09-12', '13:00:00', '15:00:00', 3),
            (29, '2026-09-05', '08:00:00', '10:00:00', 1),
            (29, '2026-09-10', '09:00:00', '11:00:00', 3),
            (29, '2026-09-15', '14:00:00', '16:00:00', 2),
            (30, '2026-09-10', '10:00:00', '12:00:00', 1),
            (30, '2026-09-15', '11:00:00', '13:00:00', 3),
            (30, '2026-09-20', '15:00:00', '17:00:00', 1),
            (31, '2026-08-10', '09:30:00', '11:30:00', 2),
            (31, '2026-08-15', '13:00:00', '15:00:00', 1),
            (31, '2026-08-20', '16:00:00', '18:00:00', 3),
            (32, '2026-08-25', '08:30:00', '10:30:00', 3),
            (32, '2026-08-30', '11:00:00', '13:00:00', 1),
            (32, '2026-09-03', '14:00:00', '16:00:00', 2),
            (33, '2026-09-05', '10:00:00', '12:00:00', 1),
            (33, '2026-09-10', '12:00:00', '14:00:00', 3),
            (33, '2026-09-15', '15:00:00', '17:00:00', 1),
            (34, '2026-08-20', '09:00:00', '11:00:00', 2),
            (34, '2026-08-25', '10:30:00', '12:30:00', 1),
            (34, '2026-08-30', '13:00:00', '15:00:00', 3),
            (35, '2026-08-30', '08:00:00', '10:00:00', 1),
            (35, '2026-09-03', '09:00:00', '11:00:00', 3),
            (35, '2026-09-07', '14:00:00', '16:00:00', 2),
            (36, '2026-09-10', '10:00:00', '12:00:00', 1),
            (36, '2026-09-13', '11:00:00', '13:00:00', 3),
            (36, '2026-09-17', '15:00:00', '17:00:00', 1),
            (37, '2026-09-05', '09:00:00', '11:00:00', 2),
            (37, '2026-09-10', '10:30:00', '12:30:00', 1),
            (37, '2026-09-15', '13:00:00', '15:00:00', 3);
        `);

        // Создание таблицы pomodoro
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS pomodoro (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL,
                pomodoro_date DATE NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NOT NULL,
                duration INTEGER NOT NULL,
                was_interrupted BOOLEAN NOT NULL DEFAULT FALSE,
                users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
                stage_id INTEGER NOT NULL DEFAULT 0);
            `);

        // Заполнение таблицы pomodoro
        await runQuery(newClient, `
            INSERT INTO pomodoro (task_id, pomodoro_date, start_time, end_time, duration, was_interrupted, users_id) VALUES
            (1, '2026-08-05', '2026-08-05 09:00:00', '2026-08-05 09:30:00', 30, FALSE, 1),
            (1, '2026-08-05', '2026-08-05 09:30:00', '2026-08-05 10:00:00', 30, FALSE, 1),
            (2, '2026-08-06', '2026-08-06 10:00:00', '2026-08-06 10:30:00', 30, FALSE, 2),
            (3, '2026-08-07', '2026-08-07 14:00:00', '2026-08-07 14:30:00', 30, TRUE, 2),
            (5, '2026-08-08', '2026-08-08 11:00:00', '2026-08-08 11:25:00', 25, FALSE, 2),
            (6, '2026-08-09', '2026-08-09 16:00:00', '2026-08-09 16:25:00', 25, FALSE, 2),
            (7, '2026-08-10', '2026-08-10 09:15:00', '2026-08-10 09:40:00', 25, FALSE, 2),
            (10, '2026-08-11', '2026-08-11 13:00:00', '2026-08-11 13:30:00', 30, FALSE, 2),
            (11, '2026-08-12', '2026-08-12 15:00:00', '2026-08-12 15:30:00', 30, FALSE, 3),
            (12, '2026-08-13', '2026-08-13 10:00:00', '2026-08-13 10:30:00', 30, TRUE, 3),
            (15, '2026-08-14', '2026-08-14 14:30:00', '2026-08-14 14:50:00', 20, FALSE, 3),
            (16, '2026-08-15', '2026-08-15 09:00:00', '2026-08-15 09:20:00', 20, FALSE, 3),
            (17, '2026-08-16', '2026-08-16 11:00:00', '2026-08-16 11:20:00', 20, FALSE, 3),
            (20, '2026-08-17', '2026-08-17 16:00:00', '2026-08-17 16:30:00', 30, FALSE, 4),
            (21, '2026-08-18', '2026-08-18 10:00:00', '2026-08-18 10:30:00', 30, FALSE, 4),
            (22, '2026-08-19', '2026-08-19 13:00:00', '2026-08-19 13:30:00', 30, FALSE, 4),
            (25, '2026-08-20', '2026-08-20 09:30:00', '2026-08-20 10:00:00', 30, FALSE, 4),
            (30, '2026-08-21', '2026-08-21 14:00:00', '2026-08-21 14:25:00', 25, TRUE, 5),
            (33, '2026-08-22', '2026-08-22 11:00:00', '2026-08-22 11:30:00', 30, FALSE, 5),
            (36, '2026-08-23', '2026-08-23 15:00:00', '2026-08-23 15:20:00', 20, FALSE, 5);
        `);

        // Создание таблицы stages
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS stages (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                stage_name VARCHAR(200) NOT NULL,
                description TEXT NOT NULL,
                deadline DATE NOT NULL DEFAULT '3000-01-01',
                pomodoros_planned INTEGER NOT NULL DEFAULT -1,
                final_deadline DATE NOT NULL DEFAULT '1900-01-01',
                pomodoros_spent INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                order_stage_in_list INTEGER NOT NULL
             );
        `);

        // Заполнение таблицы stages
        await runQuery(newClient, `
            INSERT INTO stages (task_id, stage_name, description, deadline, pomodoros_planned, order_stage_in_list) VALUES
            (2, 'Анализ требований', 'Сбор и анализ требований к базе данных', '2026-08-15', 2, 1),
            (2, 'Проектирование схемы', 'Создание ER-диаграммы и схемы БД', '2026-08-25', 3, 2),
            (2, 'Реализация таблиц', 'Написание SQL для создания таблиц', '2026-09-05', 3, 3),
            (5, 'Изучение архитектуры', 'Знакомство с архитектурой проекта', '2026-08-10', 2, 1),
            (5, 'Чтение документации', 'Изучение документации по коду', '2026-08-15', 2, 2),
            (5, 'Запуск локально', 'Настройка и запуск проекта локально', '2026-08-20', 2, 3),
            (11, 'Сбор данных 1', 'Сбор данных из открытых источников', '2026-09-05', 4, 1),
            (11, 'Сбор данных 2', 'Сбор данных с API', '2026-09-10', 3, 2),
            (11, 'Очистка данных', 'Предобработка и очистка данных', '2026-09-15', 3, 3),
            (20, 'Изучение основ Django', 'Прохождение туториала по Django', '2026-08-30', 3, 1),
            (20, 'Создание первого приложения', 'Разработка простого приложения', '2026-09-05', 4, 2),
            (20, 'Работа с моделями', 'Изучение работы с ORM и моделями', '2026-09-10', 3, 3),
            (25, 'Сбор данных за август', 'Сбор всех чеков и записей расходов', '2026-08-15', 1, 1),
            (25, 'Категоризация расходов', 'Разделение расходов по категориям', '2026-08-20', 1, 2),
            (25, 'Анализ трат', 'Анализ самых больших статей расходов', '2026-08-25', 1, 3),
            (30, 'Настройка аутентификации', 'Настройка Firebase Auth для проекта', '2026-09-15', 2, 1),
            (30, 'Создание базы данных', 'Создание структуры Firestore', '2026-09-18', 2, 2),
            (30, 'Интеграция с приложением', 'Подключение Firebase к мобильному приложению', '2026-09-20', 1, 3),
            (33, 'Подготовка тезисов', 'Написание черновика тезисов', '2026-08-30', 3, 1),
            (33, 'Редактирование', 'Редактирование и улучшение текста', '2026-09-03', 2, 2),
            (33, 'Форматирование', 'Форматирование по требованиям конференции', '2026-09-05', 1, 3);
        `);

        // Создание таблицы dates_stages
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS dates_stages (
                id SERIAL PRIMARY KEY,
                stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
                execution_date DATE NOT NULL,
                planned_start_time TIME NOT NULL DEFAULT '00:00:00',
                planned_end_time TIME NOT NULL DEFAULT '00:00:00',
                actual_start_time TIME NOT NULL DEFAULT '00:00:00',
                actual_end_time TIME NOT NULL DEFAULT '00:00:00',
                exec_status_id INTEGER NOT NULL REFERENCES execution_status(id) ON DELETE RESTRICT
            );
        `);

        // Заполнение таблицы dates_stages
        await runQuery(newClient, `
            INSERT INTO dates_stages (stage_id, execution_date, planned_start_time, planned_end_time, exec_status_id) VALUES
            (1, '2026-08-10', '09:00:00', '10:30:00', 3),
            (1, '2026-08-12', '14:00:00', '15:30:00', 2),
            (2, '2026-08-15', '10:00:00', '12:00:00', 3),
            (3, '2026-08-20', '13:00:00', '15:00:00', 2),
            (4, '2026-08-05', '08:30:00', '10:00:00', 3);
        `);              
        // Создание исторической таблицы для dates_stages
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS dates_stages_history (
                id SERIAL PRIMARY KEY,
                dates_stages_id INTEGER NOT NULL,
                stage_id INTEGER NOT NULL,
                execution_date DATE NOT NULL,
                planned_start_time TIME NOT NULL DEFAULT '00:00:00',
                planned_end_time TIME NOT NULL DEFAULT '00:00:00',
                actual_start_time TIME NOT NULL DEFAULT '00:00:00',
                actual_end_time TIME NOT NULL DEFAULT '00:00:00',
                exec_status_id INTEGER NOT NULL REFERENCES execution_status(id) ON DELETE RESTRICT);
        `);
               
        // Создание исторической таблицы для pomodoro
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS pomodoro_history (
                id SERIAL PRIMARY KEY,
                pomodoro_id INTEGER NOT NULL,
                task_id INTEGER NOT NULL,
                pomodoro_date DATE NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NOT NULL,
                duration INTEGER NOT NULL,
                was_interrupted BOOLEAN NOT NULL DEFAULT FALSE,
                users_id INTEGER NOT NULL);               
        `);

        // Создание исторической таблицы для dates_tasks_history
        await runQuery(newClient, `
            CREATE TABLE IF NOT EXISTS dates_tasks_history (
                id SERIAL PRIMARY KEY,
                dates_tasks_id INTEGER NOT NULL,
                task_id INTEGER NOT NULL,
                execution_date DATE NOT NULL,
                planned_start_time TIME NOT NULL DEFAULT '00:00:00',
                planned_end_time TIME NOT NULL DEFAULT '00:00:00',
                actual_start_time TIME NOT NULL DEFAULT '00:00:00',
                actual_end_time TIME NOT NULL DEFAULT '00:00:00',
                exec_status_id INTEGER NOT NULL REFERENCES execution_status(id) ON DELETE RESTRICT);
        `);

        // Заполнение исторических таблиц
        await runQuery(newClient, `
            INSERT INTO pomodoro_history (pomodoro_id, task_id, pomodoro_date, start_time, end_time, duration, was_interrupted, users_id) VALUES
            (1, 1, '2026-01-05', '2026-01-05 09:00:00', '2026-01-05 09:30:00', 30, FALSE, 1),
            (2, 1, '2026-01-05', '2026-01-05 09:30:00', '2026-01-05 10:00:00', 30, FALSE, 1),
            (3, 2, '2026-01-10', '2026-01-10 10:00:00', '2026-01-10 10:30:00', 30, FALSE, 2);
        `);

        await runQuery(newClient, `
            INSERT INTO dates_tasks_history (dates_tasks_id, task_id, execution_date, planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) VALUES
            (1, 1, '2026-01-05', '09:00:00', '11:00:00', '09:05:00', '10:50:00', 3),
            (2, 1, '2026-01-10', '14:00:00', '16:00:00', '14:10:00', '15:45:00', 2),
            (3, 2, '2026-01-15', '10:00:00', '12:00:00', '10:00:00', '11:30:00', 3);
        `);

        await runQuery(newClient, `
            INSERT INTO dates_stages_history (dates_stages_id, stage_id, execution_date, planned_start_time, planned_end_time, actual_start_time, actual_end_time, exec_status_id) VALUES
            (1, 1, '2026-01-05', '09:00:00', '10:30:00', '09:10:00', '10:20:00', 3),
            (2, 1, '2026-01-10', '14:00:00', '15:30:00', '14:15:00', '15:15:00', 2),
            (3, 2, '2026-01-15', '10:00:00', '12:00:00', '10:05:00', '11:45:00', 3);
        `);

        console.log('База данных успешно создана и заполнена данными.');
    } catch (error) {
        console.error('Ошибка при инициализации базы данных:', error);
    } finally {
        newClient.release();
        await newPool.end(); // Закрываем соединение с базой данных
    }
}

// Запуск скрипта
runQueries().then(() => {
    console.log('Скрипт завершен.');
    process.exit();
});