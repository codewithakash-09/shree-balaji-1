const { pool } = require('./db');

class StockService {
    static async getStockSold(productId) {
        const query = 'SELECT sold_quantity FROM stock_sold WHERE product_id = $1';
        const result = await pool.query(query, [productId]);
        return result.rows[0]?.sold_quantity || 0;
    }
    
    static async getAllStockSold() {
        const query = 'SELECT * FROM stock_sold';
        const result = await pool.query(query);
        const stockMap = {};
        result.rows.forEach(row => {
            stockMap[row.product_id] = row.sold_quantity;
        });
        return stockMap;
    }
    
    static async updateStockSold(productId, quantity) {
        const query = `
            INSERT INTO stock_sold (product_id, sold_quantity)
            VALUES ($1, $2)
            ON CONFLICT (product_id) DO UPDATE SET
                sold_quantity = stock_sold.sold_quantity + $2,
                last_updated = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await pool.query(query, [productId, quantity]);
        return result.rows[0];
    }
    
    // ADD THIS METHOD - it's missing!
    static async setStockSold(productId, quantity) {
        const query = `
            INSERT INTO stock_sold (product_id, sold_quantity)
            VALUES ($1, $2)
            ON CONFLICT (product_id) DO UPDATE SET
                sold_quantity = $2,
                last_updated = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await pool.query(query, [productId, quantity]);
        return result.rows[0];
    }
    
    static async resetAllStockSold() {
        const query = 'UPDATE stock_sold SET sold_quantity = 0, last_updated = CURRENT_TIMESTAMP';
        await pool.query(query);
    }
    
    static async getStockLimit(productId) {
        const query = 'SELECT limit_quantity, unit FROM stock_limits WHERE product_id = $1';
        const result = await pool.query(query, [productId]);
        return result.rows[0];
    }
    
    static async getAllStockLimits() {
        const query = 'SELECT * FROM stock_limits';
        const result = await pool.query(query);
        const limits = {};
        result.rows.forEach(row => {
            limits[row.product_id] = { limit: row.limit_quantity, unit: row.unit };
        });
        return limits;
    }
    
    static async updateStockLimit(productId, limit) {
        const query = `
            INSERT INTO stock_limits (product_id, limit_quantity, unit)
            VALUES ($1, $2, (SELECT unit FROM products WHERE id = $1))
            ON CONFLICT (product_id) DO UPDATE SET
                limit_quantity = $2,
                last_updated = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await pool.query(query, [productId, limit]);
        return result.rows[0];
    }
    
    static async getAvailableStock(productId) {
        const limit = await this.getStockLimit(productId);
        if (!limit) return null;
        
        const sold = await this.getStockSold(productId);
        return Math.max(0, limit.limit_quantity - sold);
    }
}

module.exports = StockService;