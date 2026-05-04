require('dotenv').config();
process.env.TZ = 'Asia/Kolkata';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const path = require('path');

// Import database services
const { pool, initializeDatabase } = require('./db/db');
const OrderService = require('./db/orders');
const ProductService = require('./db/products');
const StockService = require('./db/stock');

// ==========================================
// Environment Validation
// ==========================================
const requiredEnvVars = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'ADMIN_TOKEN', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ CRITICAL: Missing environment variables:', missingVars.join(', '));
    process.exit(1);
}

console.log('✅ Environment variables loaded successfully');

// ==========================================
// Express App Setup
// ==========================================
const app = express();
const PORT = process.env.PORT || 5000;

// Sitemap & Robots
app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Security & Middleware
app.use(helmet({ 
    contentSecurityPolicy: false,
    xContentTypeOptions: false,
    referrerPolicy: { policy: 'no-referrer' }
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// Razorpay Setup
// ==========================================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ==========================================
// Cache and Helpers
// ==========================================
let productsCache = [];
let stockLimitsCache = {};

async function refreshCache() {
    productsCache = await ProductService.getAllProducts();
    stockLimitsCache = await StockService.getAllStockLimits();
    console.log(`✅ Cache refreshed: ${productsCache.length} products`);
}

async function getAvailableStock(productId) {
    const limit = stockLimitsCache[productId];
    if (!limit) return null;
    const sold = await StockService.getStockSold(productId);
    return Math.max(0, limit.limit - sold);
}

async function updateProductStocks() {
    for (const product of productsCache) {
        const available = await getAvailableStock(product.id);
        const inStock = available === null ? true : available > 0;
        if (product.stock !== inStock) {
            await ProductService.updateProductStockStatus(product.id, inStock);
            product.stock = inStock;
        }
    }
}

async function deductStockOnDelivery(orderId) {
    console.log(`🔍 ===== DEDUCTING STOCK FOR ORDER: ${orderId} =====`);
    
    const order = await OrderService.getOrderById(orderId);
    if (!order) {
        console.log(`❌ Order not found: ${orderId}`);
        return false;
    }
    
    if (order.stock_deducted === true) {
        console.log(`⚠️ Order ${orderId} already deducted, skipping...`);
        return true;
    }
    
    console.log(`📋 Order: ${order.id}, Status: ${order.status}, Payment: ${order.payment_method}`);
    
    const items = JSON.parse(order.items_json);
    console.log(`📦 Items:`, items.map(i => `${i.name} (ID ${i.id}) x${i.quantity}`));
    
    // BULK UPDATE - Single query per product instead of SELECT + UPDATE
    for (const item of items) {
        const productId = item.id;
        const quantity = item.quantity;
        
        const stockLimit = stockLimitsCache[productId];
        if (!stockLimit) {
            console.log(`⚠️ Product ID ${productId} has NO stock limit, skipping`);
            continue;
        }
        
        // Single query: Update stock sold directly
        await pool.query(`
            INSERT INTO stock_sold (product_id, sold_quantity)
            VALUES ($1, $2)
            ON CONFLICT (product_id) DO UPDATE SET
                sold_quantity = stock_sold.sold_quantity + $2,
                last_updated = CURRENT_TIMESTAMP
        `, [productId, quantity]);
        
        console.log(`   ✅ Product ${productId}: +${quantity}`);
    }
    
    // Mark order as deducted
    await OrderService.updateStockDeducted(orderId, true);
    
    // Quick update - only update affected products in cache
    for (const item of items) {
        const productId = item.id;
        const quantity = item.quantity;
        const product = productsCache.find(p => p.id === productId);
        if (product) {
            const newSold = (await StockService.getStockSold(productId));
            const limit = stockLimitsCache[productId];
            const inStock = limit ? (limit.limit - newSold) > 0 : true;
            if (product.stock !== inStock) {
                await ProductService.updateProductStockStatus(productId, inStock);
                product.stock = inStock;
            }
        }
    }
    
    // Refresh only affected products in cache
    for (const item of items) {
        const productId = item.id;
        const updatedProduct = await ProductService.getProductById(productId);
        if (updatedProduct) {
            const index = productsCache.findIndex(p => p.id === productId);
            if (index !== -1) productsCache[index] = updatedProduct;
        }
        stockLimitsCache = await StockService.getAllStockLimits();
    }
    
    console.log(`✅ Stock deducted for order: ${orderId}`);
    return true;
}

const calculateSecureTotal = (cartItems) => {
    let total = 0;
    const verifiedItems = [];
    cartItems.forEach(item => {
        const product = productsCache.find(p => p.id === item.id);
        if (product) {
            const qty = Math.max(0.01, parseFloat(item.quantity) || 1);
            const itemTotal = Math.round(product.price * qty * 100) / 100;
            total += itemTotal;
            verifiedItems.push({ ...product, quantity: qty });
        }
    });
    return { total: Math.round(total * 100) / 100, verifiedItems };
};

// ==========================================
// API Routes
// ==========================================

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        res.json({ success: true, products: productsCache });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ success: false, error: "Failed to load products" });
    }
});

// Create order
app.post('/api/checkout/create-order', async (req, res) => {
    try {
        const { customer, items, paymentMethod, notes } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({ error: "Cart is empty" });
        }
        
        // Check stock availability
        for (const item of items) {
            const available = await getAvailableStock(item.id);
            if (available !== null && item.quantity > available) {
                const product = productsCache.find(p => p.id === item.id);
                return res.status(400).json({ 
                    error: `${product.name} - Only ${available} ${product.unit} available in stock` 
                });
            }
        }
        
        const { total, verifiedItems } = calculateSecureTotal(items);
        if (total < 200) {
            return res.status(400).json({ error: "Minimum order is ₹200" });
        }

        const localOrderId = `SBT_${nanoid(8)}`;
        const method = paymentMethod === 'COD' ? 'COD' : 'ONLINE';

        if (method === 'COD') {
            await OrderService.createOrder({
                id: localOrderId,
                status: 'COD_CONFIRMED',
                amount_inr: total,
                customer_name: customer.name,
                customer_phone: customer.phone,
                customer_address: customer.address,
                items_json: JSON.stringify(verifiedItems),
                razorpay_order_id: null,
                payment_method: 'COD',
                notes: notes || '',
                stock_deducted: false
            });
            
            return res.json({ success: true, isCOD: true, localOrderId });
        }

        // Online Payment
        const amountInPaise = Math.floor(total * 100);
        if (amountInPaise <= 0) {
            return res.status(400).json({ error: "Invalid order amount" });
        }

        const rpOrder = await razorpay.orders.create({ 
            amount: amountInPaise, 
            currency: "INR", 
            receipt: localOrderId 
        });

        await OrderService.createOrder({
            id: localOrderId,
            status: 'PENDING',
            amount_inr: total,
            customer_name: customer.name,
            customer_phone: customer.phone,
            customer_address: customer.address,
            items_json: JSON.stringify(verifiedItems),
            razorpay_order_id: rpOrder.id,
            payment_method: 'ONLINE',
            notes: notes || '',
            stock_deducted: false
        });

        res.json({ 
            success: true, 
            isCOD: false, 
            localOrderId, 
            key_id: process.env.RAZORPAY_KEY_ID, 
            amount: rpOrder.amount, 
            razorpay_order_id: rpOrder.id 
        });
    } catch (err) {
        console.error('Order creation error:', err);
        res.status(500).json({ error: "Failed to create order" });
    }
});

// Verify payment - STOCK GETS DEDUCTED HERE
app.post('/api/checkout/verify', async (req, res) => {
    try {
        const { localOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const generatedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        if (generatedSignature === razorpay_signature) {
            const order = await OrderService.getOrderById(localOrderId);
            if (order && order.status === 'PENDING') {
                await OrderService.updateOrderStatus(localOrderId, 'PAID');
                await OrderService.updatePaymentDetails(localOrderId, razorpay_payment_id);
                
                console.log(`💰 Payment verified for order ${localOrderId}, deducting stock...`);
                await deductStockOnDelivery(localOrderId);
            }
            res.json({ success: true, message: "Payment verified" });
        } else {
            res.status(400).json({ error: "Invalid signature" });
        }
    } catch (err) {
        console.error('Verification error:', err);
        res.status(500).json({ error: "Verification failed" });
    }
});

// Retry payment
app.post('/api/checkout/retry-payment', async (req, res) => {
    try {
        const { localOrderId } = req.body;
        
        const order = await OrderService.getOrderById(localOrderId);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }
        
        if (order.status !== 'PENDING') {
            return res.status(400).json({ error: "Order cannot be retried" });
        }
        
        const amountInPaise = Math.floor(order.amount_inr * 100);
        
        const newRpOrder = await razorpay.orders.create({ 
            amount: amountInPaise, 
            currency: "INR", 
            receipt: order.id 
        });
        
        await OrderService.updateOrderStatus(localOrderId, 'PENDING');
        
        res.json({ 
            success: true, 
            key_id: process.env.RAZORPAY_KEY_ID,
            razorpay_order_id: newRpOrder.id,
            amount: newRpOrder.amount
        });
    } catch (err) {
        console.error('Payment retry error:', err);
        res.status(500).json({ error: "Failed to retry payment" });
    }
});

// Admin orders endpoint
app.get('/api/admin/orders', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        const orders = result.rows;
        
        const formattedOrders = orders.map(order => ({
            ...order,
            items: JSON.parse(order.items_json)
        }));
        
        res.json({ success: true, orders: formattedOrders });
    } catch (err) {
        console.error("Admin Error:", err);
        res.status(500).json({ success: false, error: "Server Error" });
    }
});
// Track order
app.get('/api/track-order/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    
    try {
        const order = await OrderService.getOrderById(orderId);
        
        if (!order) {
            return res.status(404).json({ success: false, error: "Order not found" });
        }
        
        const formattedOrder = { ...order, items: JSON.parse(order.items_json) };
        res.json({ success: true, order: formattedOrder });
    } catch (err) {
        console.error('Tracking error:', err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// Order history
app.get('/api/order-history/:phone', async (req, res) => {
    const phone = req.params.phone;
    
    try {
        const orders = await OrderService.getOrdersByPhone(phone);
        const formattedOrders = orders.map(order => ({
            ...order,
            items: JSON.parse(order.items_json)
        }));
        res.json({ success: true, orders: formattedOrders });
    } catch (err) {
        console.error('Order history error:', err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// Update order status
// Update order status
app.post('/api/update-order-status', async (req, res) => {
    const { orderId, newStatus, adminKey } = req.body;
    
    if (adminKey !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const order = await OrderService.getOrderById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    
    const oldStatus = order.status;
    await OrderService.updateOrderStatus(orderId, newStatus);
    
    // Deduct stock for ONLINE when marked PAID
    if (order.payment_method === 'ONLINE' && oldStatus === 'PENDING' && newStatus === 'PAID') {
        await deductStockOnDelivery(orderId);
    }
    
    // Deduct stock for COD when marked DELIVERED
    if (order.payment_method === 'COD' && oldStatus === 'COD_CONFIRMED' && newStatus === 'DELIVERED') {
        await deductStockOnDelivery(orderId);
    }
    
    res.json({ success: true });
});
// Stock management endpoint
app.get('/api/stocks', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    try {
        const stockInfo = [];
        for (const product of productsCache) {
            const limit = stockLimitsCache[product.id];
            const sold = await StockService.getStockSold(product.id);
            const available = limit ? Math.max(0, limit.limit - sold) : null;
            
            stockInfo.push({
                id: product.id,
                name: product.name,
                unit: product.unit,
                limit: limit ? limit.limit : 'Unlimited',
                sold: sold,
                available: available,
                inStock: product.stock
            });
        }
        res.json({ success: true, stocks: stockInfo });
    } catch (err) {
        console.error('Error fetching stocks:', err);
        res.status(500).json({ success: false, error: "Failed to fetch stocks" });
    }
});

// Update stock limit
app.post('/api/admin/update-stock', async (req, res) => {
    const token = req.header('X-Admin-Token');
    const { productId, newLimit } = req.body;
    
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    try {
        await StockService.updateStockLimit(productId, newLimit);
        await StockService.setStockSold(productId, 0);
        await refreshCache();
        await updateProductStocks();
        res.json({ success: true, message: "Stock limit updated" });
    } catch (err) {
        console.error('Error updating stock:', err);
        res.status(500).json({ success: false, error: "Failed to update stock" });
    }
});

// Reset all stocks
app.post('/api/admin/reset-all-stocks', async (req, res) => {
    const token = req.header('X-Admin-Token');
    
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    try {
        await StockService.resetAllStockSold();
        await refreshCache();
        await updateProductStocks();
        res.json({ success: true, message: "All stocks reset successfully" });
    } catch (err) {
        console.error('Error resetting stocks:', err);
        res.status(500).json({ success: false, error: "Failed to reset stocks" });
    }
});

// Admin product endpoints
app.get('/api/admin/products', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    res.json({ success: true, products: productsCache });
});

app.post('/api/admin/update-product', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { productId, name, price, unit, category, image } = req.body;
    
    try {
        const updates = {};
        if (name) updates.name = name;
        if (price) updates.price = parseFloat(price);
        if (unit) updates.unit = unit;
        if (category) updates.category = category;
        if (image) updates.image = image;
        
        await ProductService.updateProduct(productId, updates);
        await refreshCache();
        res.json({ success: true, message: "Product updated successfully" });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ success: false, error: "Failed to update product" });
    }
});

app.post('/api/admin/add-product', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { name, price, unit, category, image, stockLimit } = req.body;
    
    try {
        const newProduct = await ProductService.addProduct({
            name, price: parseFloat(price), unit, category, image: image || null
        });
        
        if (stockLimit && stockLimit > 0) {
            await StockService.updateStockLimit(newProduct.id, parseFloat(stockLimit));
        }
        
        await refreshCache();
        res.json({ success: true, message: "Product added successfully", product: newProduct });
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ success: false, error: "Failed to add product" });
    }
});

app.post('/api/admin/delete-product', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { productId } = req.body;
    
    try {
        await ProductService.deleteProduct(productId);
        await refreshCache();
        res.json({ success: true, message: "Product deleted successfully" });
    } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ success: false, error: "Failed to delete product" });
    }
});

app.post('/api/admin/update-price', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { productId, newPrice } = req.body;
    
    try {
        await ProductService.updateProductPrice(productId, newPrice);
        await refreshCache();
        res.json({ success: true, message: "Price updated successfully" });
    } catch (err) {
        console.error('Error updating price:', err);
        res.status(500).json({ success: false, error: "Failed to update price" });
    }
});

app.post('/api/admin/update-stock-limit', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { productId, newLimit } = req.body;
    
    try {
        await StockService.updateStockLimit(productId, newLimit);
        await refreshCache();
        res.json({ success: true, message: "Stock limit updated" });
    } catch (err) {
        console.error('Error updating stock limit:', err);
        res.status(500).json({ success: false, error: "Failed to update stock limit" });
    }
});
// // Update order status (called from admin panel)
// app.post('/api/update-order-status', async (req, res) => {
//     const { orderId, newStatus, adminKey } = req.body;
    
//     if (adminKey !== process.env.ADMIN_TOKEN) {
//         return res.status(401).json({ error: "Unauthorized" });
//     }
    
//     const validStatuses = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COD_CONFIRMED'];
//     if (!validStatuses.includes(newStatus)) {
//         return res.status(400).json({ error: "Invalid status" });
//     }
    
//     try {
//         const order = await OrderService.getOrderById(orderId);
//         if (!order) {
//             return res.status(404).json({ error: "Order not found" });
//         }
        
//         const oldStatus = order.status;
//         console.log(`📝 Updating order ${orderId}: ${oldStatus} -> ${newStatus}`);
        
//         // Update the status
//         await OrderService.updateOrderStatus(orderId, newStatus);
        
//         // Case 1: ONLINE payment - deduct stock when status changes from PENDING to PAID
//         if (order.payment_method === 'ONLINE' && oldStatus === 'PENDING' && newStatus === 'PAID') {
//             console.log(`💰 ONLINE order marked as PAID, deducting stock...`);
//             await deductStockOnDelivery(orderId);
//         }
        
//         // Case 2: COD - deduct stock when status changes from COD_CONFIRMED to DELIVERED
//         if (order.payment_method === 'COD' && oldStatus === 'COD_CONFIRMED' && newStatus === 'DELIVERED') {
//             console.log(`🚚 COD order marked as DELIVERED, deducting stock...`);
//             await deductStockOnDelivery(orderId);
//         }
        
//         // Case 3: Also handle if admin marks PAID order directly to DELIVERED (deduct if not already deducted)
//         if (order.payment_method === 'ONLINE' && oldStatus === 'PAID' && newStatus === 'DELIVERED' && !order.stock_deducted) {
//             console.log(`📦 Order marked as DELIVERED, deducting stock (wasn't deducted before)...`);
//             await deductStockOnDelivery(orderId);
//         }
        
//         res.json({ success: true, message: "Status updated" });
//     } catch (err) {
//         console.error('Update status error:', err);
//         res.status(500).json({ error: "Update failed" });
//     }
// });
app.post('/api/admin/clear-orders', async (req, res) => {
    const token = req.header('X-Admin-Token');
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    try {
        await pool.query('TRUNCATE TABLE orders CASCADE');
        res.json({ success: true, message: "Orders cleared successfully" });
    } catch (err) {
        console.error('Failed to clear orders:', err);
        res.status(500).json({ success: false, error: "Failed to clear orders" });
    }
});
// Add this temporary endpoint to test stock deduction directly
app.post('/api/debug/deduct-stock', async (req, res) => {
    const { orderId } = req.body;
    const token = req.header('X-Admin-Token');
    
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    console.log(`🔧 MANUAL STOCK DEDUCTION for order: ${orderId}`);
    await deductStockOnDelivery(orderId);
    
    res.json({ success: true, message: "Stock deduction attempted" });
});
// ==========================================
// Start Server
// ==========================================
async function startServer() {
    try {
        await initializeDatabase();
        await refreshCache();
        await updateProductStocks();
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`📦 Products loaded: ${productsCache.length}`);
            console.log(`💾 Database: Neon PostgreSQL`);
            console.log(`✅ Stock deduction is ACTIVE`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();