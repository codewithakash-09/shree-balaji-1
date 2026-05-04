const { pool } = require('./db');

class ProductService {
    static async getAllProducts() {
        const query = 'SELECT * FROM products ORDER BY id';
        const result = await pool.query(query);
        return result.rows;
    }
    
    static async getProductById(id) {
        const query = 'SELECT * FROM products WHERE id = $1';
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }
    
    static async updateProductPrice(id, price) {
        const query = 'UPDATE products SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [price, id]);
        return result.rows[0];
    }
    
    static async updateProductStockStatus(id, inStock) {
        const query = 'UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [inStock, id]);
        return result.rows[0];
    }
    
    static async addProduct(product) {
        const query = `
            INSERT INTO products (name, price, unit, category, stock, image)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [product.name, product.price, product.unit, product.category, true, product.image];
        const result = await pool.query(query, values);
        return result.rows[0];
    }
    
    static async updateProduct(id, updates) {
        const fields = [];
        const values = [];
        let paramIndex = 1;
        
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }
        
        if (fields.length === 0) return null;
        
        values.push(id);
        const query = `UPDATE products SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                      WHERE id = $${paramIndex} RETURNING *`;
        const result = await pool.query(query, values);
        return result.rows[0];
    }
    
    static async deleteProduct(id) {
        const query = 'DELETE FROM products WHERE id = $1 RETURNING *';
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }
}

module.exports = ProductService;