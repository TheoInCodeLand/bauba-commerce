const db = require('../config/db');
const { slugify } = require('../utils/slugify');

async function getAllDepartments() {
    const result = await db.query('SELECT * FROM departments ORDER BY sort_order, name');
    return result.rows;
}

async function getDepartmentById(id) {
    const result = await db.query('SELECT * FROM departments WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function createDepartment({ name, description, imageUrl, sortOrder, isActive }) {
    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO departments (name, slug, description, image_url, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, slug, description || null, imageUrl || null, sortOrder || 0, isActive !== false]
    );
    return result.rows[0];
}

async function updateDepartment(id, { name, description, imageUrl, sortOrder, isActive }) {
    const slug = slugify(name);
    const result = await db.query(
        `UPDATE departments
         SET name = $1,
             slug = $2,
             description = $3,
             image_url = $4,
             sort_order = $5,
             is_active = $6
         WHERE id = $7
         RETURNING *`,
        [name, slug, description || null, imageUrl || null, sortOrder || 0, isActive !== false, id]
    );
    return result.rows[0] || null;
}

async function deleteDepartment(id) {
    await db.query('DELETE FROM departments WHERE id = $1', [id]);
    return true;
}

module.exports = {
    getAllDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
};
