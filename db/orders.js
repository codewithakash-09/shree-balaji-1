const { pool } = require('./db');

class OrderService {
      static async createOrder(orderData) {
    // Just use new Date() - TZ is already set to Asia/Kolkata
    const now = new Date();
    
    // Format as YYYY-MM-DD HH:MM:SS (IST)
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const istString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    const query = `
        INSERT INTO orders (id, status, amount_inr, customer_name, customer_phone, 
            customer_address, items_json, razorpay_order_id, razorpay_payment_id, 
            payment_method, notes, stock_deducted, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
    `;
    const values = [
        orderData.id, orderData.status, orderData.amount_inr, orderData.customer_name,
        orderData.customer_phone, orderData.customer_address, orderData.items_json,
        orderData.razorpay_order_id || null, orderData.razorpay_payment_id || null,
        orderData.payment_method, orderData.notes || '', orderData.stock_deducted || false,
        orderData.created_at || istString
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
}
    static async getOrderById(id) {
        const query = 'SELECT * FROM orders WHERE id = $1';
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }
    
    static async getOrdersByPhone(phone) {
        const query = 'SELECT * FROM orders WHERE customer_phone = $1 ORDER BY created_at DESC';
        const result = await pool.query(query, [phone]);
        return result.rows;
    }
    
    static async getAllOrders(limit = 500, offset = 0) {
    // Remove ORDER BY from here, let the server handle sorting
    const query = 'SELECT * FROM orders LIMIT $1 OFFSET $2';
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
}
    
    static async updateOrderStatus(id, status) {
        const query = 'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [status, id]);
        return result.rows[0];
    }
    
    static async updateStockDeducted(id, stockDeducted) {
        const query = 'UPDATE orders SET stock_deducted = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [stockDeducted, id]);
        return result.rows[0];
    }
    
    static async updatePaymentDetails(id, razorpayPaymentId) {
        const query = 'UPDATE orders SET razorpay_payment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [razorpayPaymentId, id]);
        return result.rows[0];
    }
}

module.exports = OrderService;