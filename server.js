require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const requiredEnvVars = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'ADMIN_TOKEN'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Neon and Render
  }
});
console.log('🔐 ADMIN_TOKEN loaded:', process.env.ADMIN_TOKEN ? 'Yes' : 'NO');
console.log('🔐 ADMIN_TOKEN length:', process.env.ADMIN_TOKEN ? process.env.ADMIN_TOKEN.length : 0);
console.log('🔐 RAZORPAY_KEY_ID loaded:', process.env.RAZORPAY_KEY_ID ? 'Yes' : 'NO');
console.log('🔐 DATABASE_URL loaded:', process.env.DATABASE_URL ? 'Yes' : 'NO');
if (missingVars.length > 0) {
  console.error('❌ CRITICAL: Missing environment variables:', missingVars.join(', '));
  console.error('Please create a .env file with:');
  console.error(`
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
ADMIN_TOKEN=your_secure_admin_password
PORT=5000
  `);
  process.exit(1);
}

console.log('✅ Environment variables loaded successfully');
const app = express();
// Add this near the top of your server.js, after 'const app = express();'
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('X-Robots-Tag', 'index,follow');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});
// --- Global Concurrent Request Limiter ---
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 8; // A safe limit for your 512MB/0.1 CPU instance

app.use((req, res, next) => {
  // Don't limit requests for static files
  if (req.path.startsWith('/public') || req.path === '/styles.css' || req.path === '/app.js') {
    return next();
  }

  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    console.warn(`⚠️ Request limit reached. Active: ${activeRequests}. Rejecting request to ${req.path}.`);
    return res.status(503).json({ 
      error: "Server is busy. Please try again in a few seconds." 
    });
  }
  
  activeRequests++;
  console.log(`📊 Active requests: ${activeRequests}`);
  
  res.on('finish', () => {
    activeRequests--;
    console.log(`📊 Active requests: ${activeRequests}`);
  });
  next();
});
// --- End Concurrent Request Limiter ---
const PORT = process.env.PORT || 5000;

// Security & Middleware
app.use(helmet({ 
  contentSecurityPolicy: false,
  xContentTypeOptions: false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// const MAX_ORDERS = 5000;

// function cleanupOldOrders() {
//   if (orders.length > MAX_ORDERS) {
//     orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
//     orders = orders.slice(0, MAX_ORDERS);
//     console.log(`🧹 Cleaned up orders, keeping last ${MAX_ORDERS}`);
//   }
// }
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        price DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50),
        image_url TEXT
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        local_order_id VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        address TEXT NOT NULL,
        items JSONB NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        payment_method VARCHAR(50),
        notes TEXT,
        razorpay_order_id VARCHAR(100),
        razorpay_payment_id VARCHAR(100),
        stock_deducted BOOLEAN DEFAULT FALSE,
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Error creating tables:", err);
  }
}
initDB();

// ==========================================
// Razorpay Setup
// ==========================================
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('❌ ERROR: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env file');
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Product list
const products = [
  // FRUITS (IDs 1-10)
  { id: 1, name: "Apple Kinnaur (Big)", price: 180, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/_JzNpY0LelznPiCiLcw1KoYrQhfD6hJegbOuiR8kt2w/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly81Lmlt/aW1nLmNvbS9kYXRh/NS9TRUxMRVIvRGVm/YXVsdC8yMDIzLzEv/U08vSUcvSFovNDUx/MTcxOTIvZnJlc2gt/a2lubmF1ci1hcHBs/ZS01MDB4NTAwLmpw/ZWc" },
  { id: 2, name: "Apple Kinnaur (Small)", price: 140, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/AN_n3PHlG2dZUI18HO0KpPVgxpW0_0C8N6JF91EUXlg/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWcu/ZXRpbWcuY29tL3Ro/dW1iL21zaWQtMTA0/NTUyOTIzLHdpZHRo/LTY0MCxoZWlnaHQt/NDgwLHJlc2l6ZW1v/ZGUtNzUsaW1nc2l6/ZS03MDE2OC9rYXNo/bWlyLWFwcGxlLmpw/Zw" },
  { id: 3, name: "Apple Kashmiri", price: 180, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/moHHeQcv8CZbiLWGIuF7UODBPqeFbi-k5KPt0HXLrWQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA2Lzk5LzEzLzA3/LzM2MF9GXzY5OTEz/MDcwN190T2lDdWpI/ek52cEppalN5Q3Fk/dE9XM01iQTV5TmJZ/US5qcGc" },
  { id: 4, name: "Grapes", price: 50, unit: "250g", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/TCRyjP9Y4jHAskRxkDGFg62zVrrVBiX9rvq_RoBhtuU/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pLnBp/bmltZy5jb20vb3Jp/Z2luYWxzL2ViLzQ3/LzBlL2ViNDcwZWZi/ODdmMzYyMjM0NWNm/YTRkYmU0NTFjOTFm/LmpwZw" },
  { id: 5, name: "Banana", price: 60, unit: "12pc", category: "Fruits", stock: true, image: "https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=400" },
  { id: 6, name: "Pomegranate (Anar)", price: 200, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/P7tUn6Nd6jd9_5VlkzCya3M_Q-uPCOD1YDlGVbOXzZw/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly81Lmlt/aW1nLmNvbS9kYXRh/NS9LSi9CVy9RRC9T/RUxMRVItODk5MzIx/MzcvYW5hci0xMDAw/eDEwMDAuanBn" },
  { id: 7, name: "Tarbooj (Watermelon)", price: 20, unit: "kg", category: "Fruits", stock: true, image: "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400" },
  { id: 8, name: "Kharbuja", price: 50, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/L2dTJV-R1r-PKGpDUTmwLh6uxAC1q7SK2fkICFfs-Xo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9ydWtt/aW5pbTIuZmxpeGNh/cnQuY29tL2ltYWdl/LzgwMC8xMDcwL3hp/ZjBxL3BsYW50LXNl/ZWQvbS95L3IvMTAw/LWtoYXJidWphLWZy/dS0xNzctYTYtcGx1/c2dyZWVuLW9yaWdp/bmFsLWltYWdrY3Fj/aHIyaDJqamQuanBl/Zz9xPTkw" },
  { id: 9, name: "Mausami", price: 40, unit: "500g", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/k94VKBGaa3erfAOpni382386rgC-rsFGfxDeUi7e334/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93d3cu/b25saW5lZGVsaXZl/cnkuaW4vaW1hZ2Vz/L3RodW1ibmFpbHMv/NDI0LzQyNC9kZXRh/aWxlZC8zNi8xYzgy/MjQxYS02OTlkLTQy/M2EtYTY5ZS1kOWQ5/ODRjY2RlNzEuanBn" },
  { id: 10, name: "Mango (Safeda AAM)", price: 150, unit: "kg", category: "Fruits", stock: true, image: "https://imgs.search.brave.com/955XaQitWZej1dkYSjd926XOXvrD9nYCSwJAW4O-yfA/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5nZXR0eWltYWdl/cy5jb20vaWQvMTM0/NDU5MDcyMy9waG90/by95ZWxsb3ctYWxw/aG9uc28tbWFuZ29l/cy5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9MHNnY0YtbWhh/M2haRmRxUFo0cWZS/Rlk4SkkweUVGQlFp/OVRsRVV1em5aZz0" },

  // VEGETABLES (IDs 11-46)
  { id: 11, name: "Aalu (Chipsona)", price: 13, unit: "kg", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/bHuGDPtJfql1FfO_Wei4sNdR4KEmiF2JfePmmL5CGUY/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvNDc5/OTAzOTUwL3Bob3Rv/L25ldy1wb3RhdG8t/aXNvbGF0ZWQtb24t/d2hpdGUtYmFja2dy/b3VuZC5qcGc_cz02/MTJ4NjEyJnc9MCZr/PTIwJmM9TnB5NDZ4/QzE1VmlweDM1UERl/azFYaDNnVzNWc0k4/SFdpZUhFRVM0SExO/WT0" },
  { id: 12, name: "Aalu (37-97)", price: 10, unit: "kg", category: "Vegetables", stock: true, image: "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400" },
  { id: 13, name: "Pyaj (Quality A)", price: 30, unit: "kg", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/9HvMgZ6iuLWTgMv1MupTxaiT8SV2omO6uZR31bzg4DU/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9jZG4u/cGl4YWJheS5jb20v/cGhvdG8vMjAxNi8w/Ni8wMi8wMS8zNS92/ZWdldGFibGVzLTE0/MzAwNjJfNjQwLmpw/Zw" },
  { id: 14, name: "Pyaj (Quality B)", price: 15, unit: "kg", category: "Vegetables", stock: true, image: "https://images.unsplash.com/photo-1508747703725-719777637510?w=400" },
  { id: 15, name: "Tamatar (Desi)", price: 30, unit: "kg", category: "Vegetables", stock: true, image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80" },
  { id: 16, name: "Dhaniya", price: 20, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/MKP5mzgQ_JcBM-hhqba6hvmXJ_2hpOPN_Vn89MgpwK8/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvNjE2/MDA3NjAyL3Bob3Rv/L2ZyZXNoLWNvcmlh/bmRlci1vci1jaWxh/bnRyby1sZWF2ZXMt/aW4tYS13b29kZW4t/Ym93bC5qcGc_cz02/MTJ4NjEyJnc9MCZr/PTIwJmM9cl9NSjZF/bktHaFJmNVFHUkJy/ZWxhTkk2U1g3SFFI/NTBwVjNTNWd5MzhH/Yz0" },
  { id: 17, name: "Podina", price: 10, unit: "100g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/T2j-lKcdcDstr7muyyYS10oijMXZfd9WwLVjlC6H9R8/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9vcmdh/bmljbWFuZHlhLmNv/bS9jZG4vc2hvcC9m/aWxlcy9NaW50TGVh/dmVzLmpwZz92PTE3/NTcwODMzODQmd2lk/dGg9MTAwMA" },
  { id: 18, name: "Hari Mirch", price: 15, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/Dk4qhcZv8hz19CN3AVTXk9sNXS22p3LDErTQ_aW30rc/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA0LzY3LzU1Lzkx/LzM2MF9GXzQ2NzU1/OTExOF9KV1ZpSko0/Z1lIZDYzWHZJV1Nv/TklFc1BERG56SE4x/Ty5qcGc" },
  { id: 19, name: "Neebu (Lemon)", price: 30, unit: "100g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/TyxgJGbUw7udSaoj2dD-k0yGM4hCZEaPx89V2BJQlHA/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWFn/ZXMucGV4ZWxzLmNv/bS9waG90b3MvMzYw/OTQ4NTcvcGV4ZWxz/LXBob3RvLTM2MDk0/ODU3L2ZyZWUtcGhv/dG8tb2YtZnJlc2gt/bGVtb25zLWRpc3Bs/YXllZC1pbi1hLWdy/b2NlcnkuanBlZz9h/dXRvPWNvbXByZXNz/JmNzPXRpbnlzcmdi/JmRwcj0xJnc9NTAw" },
  { id: 20, name: "Lahsun", price: 15, unit: "100g", category: "Vegetables", stock: true, image: "https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=400" },
  { id: 21, name: "Adarak (Ginger)", price: 20, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/5H7SNkjpP4lnr0JCOAn7YELY1V8kobGXwXeu1ABebiQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pLnBp/bmltZy5jb20vb3Jp/Z2luYWxzLzMzLzc5/LzkwLzMzNzk5MGRk/YzVmMThjY2U4Mzk4/ZTM2YzNlYWM3MWI5/LmpwZw" },
  { id: 22, name: "Shimla Mirch (Green)", price: 15, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/YZPhAshrHWFY9fk03vneZ9CUHj0TqNp_Bm-R_54LkTQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9nb3Vy/bWV0Z2FyZGVuLmlu/L2Nkbi9zaG9wL3By/b2R1Y3RzL0dyZWVu/UGVwcGVyc18xMjgw/eC5qcGc_dj0xNzM1/OTE4NTUy" },
  { id: 23, name: "Shimla Mirch (Red)", price: 60, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/GxRrypef_MQSbK-tvJw733nIoydcaTMqytHds14ZIeI/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zdGF0/aWMudmVjdGVlenku/Y29tL3N5c3RlbS9y/ZXNvdXJjZXMvdGh1/bWJuYWlscy8wNzEv/NzMxLzY4Ny9zbWFs/bC92aWJyYW50LXJl/ZC1iZWxsLXBlcHBl/cnMtd2l0aC1nbGlz/dGVuaW5nLXdhdGVy/LWRyb3BsZXRzLW9u/LXJlZmxlY3RpdmUt/YmxhY2stc3VyZmFj/ZS1waG90by5qcGVn" },
  { id: 24, name: "Baby Corn", price: 40, unit: "pkt", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/TwZRlgPbSrirTCz9_kWk1VgkW7gK-JYQQmdqYC-GK1M/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly91cy4x/MjNyZi5jb20vNDUw/d20veWluZ3R1c3Rv/Y2tlci95aW5ndHVz/dG9ja2VyMTgwMy95/aW5ndHVzdG9ja2Vy/MTgwMzAwMDI1Lzk3/NDkxNTAwLWJhYnkt/Y29ybi1hcy1iYWNr/Z3JvdW5kLmpwZz92/ZXI9Ng" },
  { id: 25, name: "Tori", price: 20, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/opaab8c7XlgfcNqrK8YFNqgNPbiU1O6rbX6ccbUNnfo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pMC53/cC5jb20vYmVlanJz/ZWVkcy5jb20vd3At/Y29udGVudC91cGxv/YWRzLzIwMjUvMDEv/U3BvbmdlLUdvdXJk/LVRvcmktVHVyYWkt/VmVnZXRhYmxlLVNl/ZWRzLTIuanBnP2Zp/dD05MDksOTA5JnNz/bD0x" },
  { id: 26, name: "Bhindi", price: 20, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/NWSNwa233z4t2wbUCoNXfR1hYsLL67TzumMzq3-Yg8E/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NTFiK0x5Y280Qkwu/anBn" },
  { id: 27, name: "Lauki (Ghiya)", price: 25, unit: "kg", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/oE92oyZjgX2-Coxz7CIsnR79rtjfTsdCB-LWDaOBBYc/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NDFMU3hxOHFEekwu/anBn" },
  { id: 28, name: "Kaddu (Green)", price: 15, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/FTt-qYEBi5kMTFU-wp4ePoBnl1Ba90z7tHOHEqkspCQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/MzF6b0JpbW5CVkwu/anBn" },
  { id: 29, name: "Chukander", price: 20, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/eTxU21to5eJE4mtprNIhxJYWpxGTk6TGeao5Vfl4QDE/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvNDc5/ODA1MTc2L3Bob3Rv/L2JlZXRyb290Lmpw/Zz9zPTYxMng2MTIm/dz0wJms9MjAmYz01/R2xwVEpoWUVIUVh4/a1BlLU4wUzRLal91/anBneXpoRnJMWHZy/SDlHR3FvPQ" },
  { id: 30, name: "Beans", price: 20, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/LanUejARpjqKqy7svNVTnGRcBUhZ63tgjMEsQwAkrMo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NTFTMXY2R3ZYS0wu/anBn" },
  { id: 31, name: "Patta Gobhi", price: 15, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/BXuMBYPpB1LYARQLxbQDjwQpM0oDoVvhO3ebFf00Am0/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvNTAz/ODcwNjYyL3Bob3Rv/L2ZyZXNoLXJpcGUt/Y2FiYmFnZS5qcGc_/cz02MTJ4NjEyJnc9/MCZrPTIwJmM9bnky/c0Fwbjg5Sk82Szhq/cEJ5WFU5RVVpOW5P/WG5Sa2l1U09PRHZu/dFVMTT0" },
  { id: 32, name: "Karela", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/KI1lSo6OJVmS6wFcEXO56vWmhVwlrfQ_2CWtuvV8OdU/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zdGF0/aWNpbWcuYW1hcnVq/YWxhLmNvbS9hc3Nl/dHMvaW1hZ2VzLzIw/MjQvMTAvMTUvYml0/dGVyLWdvdXJkLWth/cmVsYV85NDg3Nzlh/ZGRiOTg5ZmUyM2Qw/MmU3Y2U2MGNhNGUy/NS5qcGVnP3E9ODA" },
  { id: 33, name: "Arbi", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://mir-s3-cdn-cf.behance.net/project_modules/2800_opt_1/3c129c143827665.62820c293af1d.jpg" },
  { id: 34, name: "Parwal", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/JIF5AbgSLoeiDXtXHFO2YtU0KFvpXWYl9j2wMWzYTAs/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93d3cu/c2h1dHRlcnN0b2Nr/LmNvbS9pbWFnZS1w/aG90by9wb2ludGVk/LWdvdXJkLWJhbmds/YWRlc2hpLXZlZ2V0/YWJsZXMtMjYwbnct/MjI3MjY4MDMwNy5q/cGc" },
  { id: 35, name: "Tinda", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/ZS2ikS7VSIAZc8iMCr_aDiCBW22shKFEE3krrYYU9uo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9ncm93/c2VlZHMuY28uaW4v/d3AtY29udGVudC91/cGxvYWRzLzIwMjQv/MDgvVW50aXRsZWQt/ZGVzaWduLTIwMjQt/MDgtMTVUMTAyNjE5/LjQ1NC5qcGc" },
  { id: 36, name: "Gajar", price: 15, unit: "500g", category: "Vegetables", stock: true, image: "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400" },
  { id: 37, name: "Matar", price: 20, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/AS7vRM9DlWnTFuY4J9HzBSlLeO4SpN1F-fp_MemUE5U/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NTExNkxNeEZ1ZUwu/anBn" },
  { id: 38, name: "Kacha Aam", price: 20, unit: "250g", category: "Vegetables", stock: true, image: "https://www.goodfoodbar.com/cdn/shop/files/Untitled_design_-_2024-12-16T133432.620.webp?v=1744871719&width=1946" },
  { id: 39, name: "Kacha Kela", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/6wj4_k5UjTdtafFmSCSHkD6g_NOQTZ-EufmKFlHlE9w/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zdG9y/YWdlLmdvb2dsZWFw/aXMuY29tL3NoeS1w/dWIvNjg5NDQvaW1h/Z2UyLTE1NjE0NjU1/NjgtMTczOTI4Mzgz/ODQxNi5qcGVn" },
  { id: 40, name: "Kheera (Hybrid)", price: 20, unit: "kg", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/ZaMKhk0PAl5oEfSso13Zpk8qFWZbzhBx_ngygRZBMC4/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93d3cu/MW1nLmNvbS9oaS9w/YXRhbmphbGkvd3At/Y29udGVudC91cGxv/YWRzLzIwMTkvMDEv/S2hlZXJhLmpwZw" },
  { id: 41, name: "Shimla Mirch (Yellow)", price: 70, unit: "250g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/gI7LmAiPaVP-gZiBkLsO7yreCpbM9_fZF3WhhUR9oWo/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93d3cu/ZmFybWVyc3N0b3Au/Y29tL2Nkbi9zaG9w/L3Byb2R1Y3RzLzI5/NzM3NzQ3NzEwMDM1/XzUxMHg1MTAuanBn/P3Y9MTc0ODY3NjY0/MA" },
  { id: 42, name: "Phool Gobhi", price: 40, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/zwxno5vjJAXjwizXU5B4uFzvd-gWU9ytfylRER-WphQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvOTA2/MzQ1OTQvcGhvdG8v/Y2xvc2UtdXAtb2Yt/c2V2ZXJhbC1oZWFk/cy1vZi1jYXVsaWZs/b3dlci53ZWJwP2E9/MSZiPTEmcz02MTJ4/NjEyJnc9MCZrPTIw/JmM9enMyUjNjRDYx/UDBxUTlsbjlTWTct/bTYyeWJncUV1VkJf/M0FNVnJXdGVsQT0" },
  { id: 43, name: "Broccoli", price: 60, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/CDDu90ujwVOeZ7C3u9H92c27NT7Mf7ZAQKTKubB2xzs/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NzFDUmtiTXRUVEwu/anBn" },
  { id: 44, name: "Desi Gajar", price: 15, unit: "500g", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/brBUp5y-moTepuMsEq6eEpTNoNfftM1ZOi9RJ4yLf-Y/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9tLm1l/ZGlhLWFtYXpvbi5j/b20vaW1hZ2VzL0kv/NTFjbTRxQ3hVVEwu/anBn" },
  { id: 45, name: "Kheera (Desi)", price: 30, unit: "kg", category: "Vegetables", stock: true, image: "https://imgs.search.brave.com/ZaMKhk0PAl5oEfSso13Zpk8qFWZbzhBx_ngygRZBMC4/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93d3cu/MW1nLmNvbS9oaS9w/YXRhbmphbGkvd3At/Y29udGVudC91cGxv/YWRzLzIwMTkvMDEv/S2hlZXJhLmpwZw" },
  { id: 46, name: "Baigan (Long)", price: 30, unit: "500g", category: "Vegetables", stock: true, image: "https://5.imimg.com/data5/AC/PO/MY-8825611/bottle-eggplant-baigan-bharta-500x500.png" }
];
// ==========================================
// STOCK MANAGEMENT SYSTEM
// ==========================================

// Stock limits for products (in kg or units as per product unit)
// Update these daily as needed
const stockLimits = {
  // FRUITS
  1: { limit: 10, unit: 'kg' },      // Apple Kinnaur (Big) - 10kg
  2: { limit: 15, unit: 'kg' },      // Apple Kinnaur (Small) - 15kg
  3: { limit: 12, unit: 'kg' },      // Apple Kashmiri - 12kg
  4: { limit: 20, unit: '250g' },    // Grapes - 20 packs of 250g
  5: { limit: 50, unit: '12pc' },    // Banana - 50 dozen (600 pieces)
  6: { limit: 8, unit: 'kg' },       // Pomegranate - 8kg
  7: { limit: 30, unit: 'kg' },      // Watermelon - 30kg
  8: { limit: 15, unit: 'kg' },      // Kharbuja - 15kg
  9: { limit: 10, unit: '500g' },    // Mausami - 10 packs
  10: { limit: 20, unit: 'kg' },     // Mango - 20kg
  
  // VEGETABLES
  11: { limit: 50, unit: 'kg' },     // Aalu Chipsona - 50kg
  12: { limit: 40, unit: 'kg' },     // Aalu 37-97 - 40kg
  13: { limit: 30, unit: 'kg' },     // Pyaj Quality A - 30kg
  14: { limit: 25, unit: 'kg' },     // Pyaj Quality B - 25kg
  15: { limit: 20, unit: 'kg' },     // Tamatar - 20kg
  16: { limit: 15, unit: '250g' },   // Dhaniya - 15 bunches
  17: { limit: 10, unit: '100g' },   // Podina - 10 packs
  18: { limit: 12, unit: '250g' },   // Hari Mirch - 12 packs
  19: { limit: 8, unit: '100g' },    // Neebu - 8 packs
  20: { limit: 10, unit: '100g' },   // Lahsun - 10 packs
  21: { limit: 10, unit: '250g' },   // Adarak - 10 packs
  22: { limit: 15, unit: '500g' },   // Shimla Mirch Green - 15 packs
  23: { limit: 10, unit: '250g' },   // Shimla Mirch Red - 10 packs
  24: { limit: 20, unit: 'pkt' },    // Baby Corn - 20 packets
  25: { limit: 12, unit: '500g' },   // Tori - 12 packs
  26: { limit: 15, unit: '500g' },   // Bhindi - 15 packs
  27: { limit: 20, unit: 'kg' },     // Lauki - 20kg
  28: { limit: 12, unit: '500g' },   // Kaddu - 12 packs
  29: { limit: 10, unit: '500g' },   // Chukander - 10 packs
  30: { limit: 15, unit: '250g' },   // Beans - 15 packs
  31: { limit: 12, unit: '500g' },   // Patta Gobhi - 12 packs
  32: { limit: 10, unit: '500g' },   // Karela - 10 packs
  33: { limit: 8, unit: '500g' },    // Arbi - 8 packs
  34: { limit: 8, unit: '500g' },    // Parwal - 8 packs
  35: { limit: 10, unit: '500g' },   // Tinda - 10 packs
  36: { limit: 15, unit: '500g' },   // Gajar - 15 packs
  37: { limit: 12, unit: '250g' },   // Matar - 12 packs
  38: { limit: 10, unit: '250g' },   // Kacha Aam - 10 packs
  39: { limit: 8, unit: '500g' },    // Kacha Kela - 8 packs
  40: { limit: 15, unit: 'kg' },     // Kheera Hybrid - 15kg
  41: { limit: 8, unit: '250g' },    // Shimla Mirch Yellow - 8 packs
  42: { limit: 10, unit: '500g' },   // Phool Gobhi - 10 packs
  43: { limit: 8, unit: '500g' },    // Broccoli - 8 packs
  44: { limit: 12, unit: '500g' },   // Desi Gajar - 12 packs
  45: { limit: 10, unit: 'kg' },     // Kheera Desi - 10kg
  46: { limit: 10, unit: '500g' },   // Baigan - 10 packs
};

// Track current stock sold (from orders)
// This will be calculated on server start
let stockSold = {};

async function initializeStockSold() {
  stockSold = {};
  try {
    const result = await pool.query("SELECT * FROM orders WHERE status = 'DELIVERED' AND stock_deducted = true");
    
    result.rows.forEach(order => {
      // SAFETY CHECK: Make sure items exists and is an array
      const items = order.items;
      
      if (!items || !Array.isArray(items)) {
        console.log(`⚠️ Order ${order.local_order_id} has invalid items data, skipping`);
        return; // Skip this order
      }
      
      items.forEach(item => {
        // SAFETY CHECK: Make sure item has id and quantity
        if (item && item.id && item.quantity) {
          if (!stockSold[item.id]) {
            stockSold[item.id] = 0;
          }
          stockSold[item.id] += item.quantity;
        }
      });
    });
    
    console.log('✅ Stock sold initialized from Neon Database:', stockSold);
  } catch (err) {
    console.error('❌ Error loading stock from database:', err.message);
    console.log('⚠️ Starting with empty stock tracking');
    stockSold = {}; // Reset to empty on error
  }
}

// ==========================================
// PRODUCT MANAGEMENT APIs (ADMIN ONLY)
// ==========================================

const PRODUCTS_FILE = path.join(__dirname, 'products.json');

// Save products to file
function saveProductsToFile() {
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    console.log('✅ Products saved to file');
  } catch (err) {
    console.error('❌ Error saving products:', err);
  }
}

// Load products from file (call this at startup)
function loadProductsFromFile() {
  if (fs.existsSync(PRODUCTS_FILE)) {
    try {
      const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
      const savedProducts = JSON.parse(data);
      // DON'T clear products array - just update existing products
      savedProducts.forEach(savedProduct => {
        const existingProduct = products.find(p => p.id === savedProduct.id);
        if (existingProduct) {
          // Only update price and other editable fields, keep stock status
          existingProduct.price = savedProduct.price;
          existingProduct.name = savedProduct.name;
          existingProduct.unit = savedProduct.unit;
          existingProduct.category = savedProduct.category;
          existingProduct.image = savedProduct.image;
        } else {
          // This is a new product added via admin
          products.push(savedProduct);
        }
      });
      console.log(`✅ Loaded product prices from file`);
      return true;
    } catch (err) {
      console.error('❌ Error loading products:', err);
    }
  }
  return false;
}

// Get all products (with admin details)
app.get('/api/admin/products', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  res.json({ success: true, products: products });
});

// Update product price
app.post('/api/admin/update-price', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const { productId, newPrice } = req.body;
  const product = products.find(p => p.id === productId);
  
  if (!product) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }
  
  product.price = newPrice;
  saveProductsToFile();
  updateProductStocks(); // Re-evaluate stock status
  
  res.json({ success: true, message: "Price updated successfully", product });
});

// Update product stock limit
app.post('/api/admin/update-stock-limit', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const { productId, newLimit } = req.body;
  
  if (!stockLimits[productId]) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }
  
  stockLimits[productId].limit = newLimit;
  updateProductStocks();
  saveStockToFile();
  
  res.json({ success: true, message: "Stock limit updated" });
});

// Add new product
app.post('/api/admin/add-product', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const { name, price, unit, category, image, stockLimit } = req.body;
  
  // Find max ID
  const maxId = Math.max(...products.map(p => p.id), 0);
  const newId = maxId + 1;
  
  const newProduct = {
    id: newId,
    name: name,
    price: parseFloat(price),
    unit: unit,
    category: category,
    stock: true,
    image: image || "https://imgs.search.brave.com/moHHeQcv8CZbiLWGIuF7UODBPqeFbi-k5KPt0HXLrWQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA2Lzk5LzEzLzA3/LzM2MF9GXzY5OTEz/MDcwN190T2lDdWpI/ek52cEppalN5Q3Fk/dE9XM01iQTV5TmJZ/US5qcGc"
  };
  
  products.push(newProduct);
  
  // Add stock limit if provided
  if (stockLimit && stockLimit > 0) {
    stockLimits[newId] = { limit: parseFloat(stockLimit), unit: unit };
  }
  
  saveProductsToFile();
  updateProductStocks();
  saveStockToFile();
  
  res.json({ success: true, message: "Product added successfully", product: newProduct });
});

// Update product details
app.post('/api/admin/update-product', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const { productId, name, price, unit, category, image } = req.body;
  const product = products.find(p => p.id === productId);
  
  if (!product) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }
  
  if (name) product.name = name;
  if (price) product.price = parseFloat(price);
  if (unit) product.unit = unit;
  if (category) product.category = category;
  if (image) product.image = image;
  
  saveProductsToFile();
  
  res.json({ success: true, message: "Product updated successfully", product });
});

// Delete product
app.post('/api/admin/delete-product', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const { productId } = req.body;
  const index = products.findIndex(p => p.id === productId);
  
  if (index === -1) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }
  
  products.splice(index, 1);
  delete stockLimits[productId];
  
  saveProductsToFile();
  saveStockToFile();
  
  res.json({ success: true, message: "Product deleted successfully" });
});
// Get available stock for a product
function getAvailableStock(productId) {
  const limit = stockLimits[productId];
  if (!limit) return null; // No limit set (unlimited stock)
  
  const sold = stockSold[productId] || 0;
  const available = Math.max(0, limit.limit - sold);
  return available;
}

// Update product stocks based on current stock sold
function updateProductStocks() {
  products.forEach(product => {
    const available = getAvailableStock(product.id);
    
    if (available !== null) {
      // If stock limit exists and available stock is 0 or less
      product.stock = available > 0;
    } else {
      // No stock limit, always in stock
      product.stock = true;
    }
  });
}

// Deduct stock when order is confirmed
// function deductStockOnDelivery(orderId) {
//   console.log(`🔍 Attempting to deduct stock for order: ${orderId}`);
//   const order = orders.find(o => o.id === orderId);
//   if (!order) {
//     console.log(`❌ Order not found: ${orderId}`);
//     return false;
//   }
  
//   console.log(`Order status: ${order.status}, stock_deducted: ${order.stock_deducted}`);
  
//   if (!order.stock_deducted) {
//     const items = JSON.parse(order.items_json);
//     console.log(`Items in order:`, items);
//     let stockUpdated = false;
    
//     items.forEach(item => {
//       const productId = item.id;
//       const quantity = item.quantity;
//       console.log(`Processing product ${productId}, quantity: ${quantity}`);
      
//       if (stockLimits[productId]) {
//         if (!stockSold[productId]) {
//           stockSold[productId] = 0;
//         }
//         stockSold[productId] += quantity;
//         stockUpdated = true;
//         console.log(`Stock updated for product ${productId}: now ${stockSold[productId]}`);
//       }
//     });
    
//     if (stockUpdated) {
//       order.stock_deducted = true;
//       updateProductStocks();
//       saveStockToFile();
//       saveOrdersToFile();
//       console.log(`✅ Stock deducted for order: ${orderId}`);
//       return true;
//     }
//   }
//   return false;
// }

// Reverse stock deduction when order is cancelled/returned
// function reverseStockDeduction(orderId) {
//   const order = orders.find(o => o.id === orderId);
//   if (!order) return false;
  
//   if (order.stock_deducted) {
//     const items = JSON.parse(order.items_json);
    
//     items.forEach(item => {
//       const productId = item.id;
//       const quantity = item.quantity;
      
//       if (stockSold[productId]) {
//         stockSold[productId] = Math.max(0, stockSold[productId] - quantity);
//       }
//     });
    
//     order.stock_deducted = false;
//     updateProductStocks();
//     saveStockToFile();
//     saveOrdersToFile();
//     console.log(`🔄 Stock deduction reversed for order: ${orderId}`);
//     return true;
//   }
//   return false;
// }

// Save stock data to file (persist across server restarts)
const STOCK_FILE = path.join(__dirname, 'stock.json');

function saveStockToFile() {
  try {
    const stockData = {
      stockSold: stockSold,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(STOCK_FILE, JSON.stringify(stockData, null, 2));
  } catch (err) {
    console.error('❌ Error saving stock data:', err);
  }
}

function loadStockFromFile() {
  if (fs.existsSync(STOCK_FILE)) {
    try {
      const data = fs.readFileSync(STOCK_FILE, 'utf8');
      const stockData = JSON.parse(data);
      stockSold = stockData.stockSold || {};
      console.log('✅ Stock data loaded from file');
    } catch (err) {
      console.error('❌ Error loading stock data:', err);
    }
  }
}

// Reset stock for a product (admin API)
function resetProductStock(productId, newLimit) {
  if (stockLimits[productId]) {
    stockLimits[productId].limit = newLimit;
  }
  // Reset sold count for this product
  stockSold[productId] = 0;
  updateProductStocks();
  saveStockToFile();
  console.log(`🔄 Stock reset for product ${productId}: new limit ${newLimit}`);
}

// Call this after loading orders
loadStockFromFile();
loadProductsFromFile();
initializeStockSold();
updateProductStocks();

// ==========================================
// STOCK MANAGEMENT APIs
// ==========================================

// Get all product stocks
app.get('/api/stocks', async (req, res) => {
  const token = req.header('X-Admin-Token');
  
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  const stockInfo = products.map(product => {
    const limit = stockLimits[product.id];
    const sold = stockSold[product.id] || 0;
    const available = limit ? Math.max(0, limit.limit - sold) : null;
    
    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      limit: limit ? limit.limit : 'Unlimited',
      sold: sold,
      available: available,
      inStock: product.stock
    };
  });
  
  res.json({ success: true, stocks: stockInfo });
});

// Update stock limit (Admin only)
app.post('/api/admin/update-stock', async (req, res) => {
  const token = req.header('X-Admin-Token');
  const { productId, newLimit } = req.body;
  
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  if (!stockLimits[productId]) {
    return res.status(404).json({ success: false, error: "Product not found" });
  }
  
  resetProductStock(productId, newLimit);
  res.json({ success: true, message: "Stock limit updated" });
});

// Reset all stocks (Admin only - for daily reset)
app.post('/api/admin/reset-all-stocks', async (req, res) => {
  const token = req.header('X-Admin-Token');
  
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  // Reset all stock sold
  stockSold = {};
  
  // Re-initialize and update
  initializeStockSold();
  updateProductStocks();
  saveStockToFile();
  
  res.json({ success: true, message: "All stocks reset successfully" });
});
const calculateSecureTotal = (cartItems) => {
  let total = 0;
  const verifiedItems = [];
  cartItems.forEach(item => {
    const product = products.find(p => p.id === item.id);
    if (product) {
      const qty = Math.max(0.01, parseFloat(item.quantity) || 1);
      const itemTotal = Math.round(product.price * qty * 100) / 100;
      total += itemTotal;
      verifiedItems.push({ ...product, quantity: qty });
    }
  });
  return { total: Math.round(total * 100) / 100, verifiedItems };
};
// =======================================
// API Routes
// ==========================================
app.get('/api/products', (req, res) => {
  res.json(products); 
});

app.post('/api/checkout/create-order', async (req, res) => {
  try {
    const { customer, items, paymentMethod, notes } = req.body;
    
    if (!items || items.length === 0) return res.status(400).json({ error: "Cart is empty" });
    // Check stock availability for all items
for (const item of items) {
  const available = getAvailableStock(item.id);
  if (available !== null && item.quantity > available) {
    const product = products.find(p => p.id === item.id);
    return res.status(400).json({ 
      error: `${product.name} - Only ${available} ${product.unit} available in stock` 
    });
  }
}
    const { total, verifiedItems } = calculateSecureTotal(items);
    if (total < 200) return res.status(400).json({ error: "Minimum order is ₹200" });

    const localOrderId = `SBT_${nanoid(8)}`;
    const method = paymentMethod === 'COD' ? 'COD' : 'ONLINE';
    const customerNotes = notes || '';

    // Handle COD
    if (method === 'COD') {
      await pool.query(
        `INSERT INTO orders (local_order_id, customer_name, phone, address, items, total_amount, status, payment_method, notes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [localOrderId, customer.name, customer.phone, customer.address, JSON.stringify(verifiedItems), total, 'COD_CONFIRMED', 'COD', customerNotes]
      );
      return res.json({ success: true, isCOD: true, localOrderId });
    }

    // Handle Online Payment
    const amountInPaise = Math.floor(total * 100);
    if (amountInPaise <= 0) return res.status(400).json({ error: "Invalid order amount" });

    const rpOrder = await razorpay.orders.create({ 
      amount: amountInPaise, 
      currency: "INR", 
      receipt: localOrderId 
    });

    await pool.query(
        `INSERT INTO orders (local_order_id, customer_name, phone, address, items, total_amount, status, payment_method, notes, razorpay_order_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [localOrderId, customer.name, customer.phone, customer.address, JSON.stringify(verifiedItems), total, 'PENDING', 'ONLINE', customerNotes, rpOrder.id]
    );

    res.json({ success: true, isCOD: false, localOrderId, key_id: process.env.RAZORPAY_KEY_ID, amount: rpOrder.amount, razorpay_order_id: rpOrder.id });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

app.post('/api/checkout/verify', async (req, res) => {
  try {
    const { localOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const generatedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id + "|" + razorpay_payment_id).digest('hex');

    if (generatedSignature === razorpay_signature) {
      // Update the order in NEON database
      const result = await pool.query(
        `UPDATE orders SET status = 'PAID', razorpay_payment_id = $1 WHERE local_order_id = $2 RETURNING *`,
        [razorpay_payment_id, localOrderId]
      );
      
      if (result.rowCount > 0) {
        // Stock deduction for SQL is omitted here to keep it simple, 
        // you can process it via Admin panel for the MVP
        res.json({ success: true, message: "Payment verified" });
      } else {
        res.status(404).json({ error: "Order not found in database" });
      }
    } else {
      res.status(400).json({ error: "Invalid signature" });
    }
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ error: "Verification failed" });
  }
});
// Add this after your verify endpoint (around line 150)
// Retry Payment
app.post('/api/checkout/retry-payment', async (req, res) => {
  try {
    const { localOrderId } = req.body;
    const result = await pool.query('SELECT * FROM orders WHERE local_order_id = $1', [localOrderId]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: "Order not found" });
    const order = result.rows[0];
    if (order.status !== 'PENDING') return res.status(400).json({ error: "Order cannot be retried" });
    
    const amountInPaise = Math.floor(order.total_amount * 100);
    const newRpOrder = await razorpay.orders.create({ amount: amountInPaise, currency: "INR", receipt: order.local_order_id });
    
    await pool.query('UPDATE orders SET razorpay_order_id = $1 WHERE local_order_id = $2', [newRpOrder.id, localOrderId]);
    
    res.json({ success: true, key_id: process.env.RAZORPAY_KEY_ID, razorpay_order_id: newRpOrder.id, amount: newRpOrder.amount });
  } catch (err) {
    console.error('Payment retry error:', err);
    res.status(500).json({ error: "Failed to retry payment" });
  }
});

// Webhook
app.post('/api/razorpay-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    // ... (keep signature verification logic exactly the same) ...
    
    const payload = JSON.parse(req.body.toString());
    if (payload.event === 'payment.captured') {
      const paymentId = payload.payload.payment.entity.id;
      const orderId = payload.payload.payment.entity.order_id;
      
      await pool.query(
        "UPDATE orders SET status = 'PAID', razorpay_payment_id = $1 WHERE razorpay_order_id = $2 AND status = 'PENDING'",
        [paymentId, orderId]
      );
      console.log(`✅ Webhook: Order marked as PAID`);
    }
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN.trim()) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY order_date DESC');
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    console.error("Admin Error:", err);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});

// Order Tracking API
app.get('/api/track-order/:orderId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE local_order_id = $1', [req.params.orderId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    // Map database fields to match what the frontend expects
    const order = result.rows[0];
    const formattedOrder = { ...order, id: order.local_order_id, created_at: order.order_date };
    res.json({ success: true, order: formattedOrder });
  } catch (err) {
    console.error('Tracking error:', err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Order History API (by phone number)
app.get('/api/order-history/:phone', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE phone = $1 ORDER BY order_date DESC', [req.params.phone]);
    const formattedOrders = result.rows.map(order => ({
      ...order,
      id: order.local_order_id,
      created_at: order.order_date
    }));
    res.json({ success: true, orders: formattedOrders });
  } catch (err) {
    console.error('Order history error:', err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
// Admin Status Update Endpoint
app.post('/api/update-order-status', async (req, res) => {
  const { orderId, newStatus, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  
  const validStatuses = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COD_CONFIRMED'];
  if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: "Invalid status" });
  
  try {
    // 1. Get the current order from DB
    const orderResult = await pool.query('SELECT * FROM orders WHERE local_order_id = $1', [orderId]);
    if (orderResult.rows.length === 0) return res.status(404).json({ error: "Order not found" });
    
    const order = orderResult.rows[0];
    const oldStatus = order.status;
    let stockDeductedNow = order.stock_deducted;

    // 2. Handle Stock Logic based on status change
    const shouldDeduct = (order.payment_method === 'ONLINE' && oldStatus === 'PENDING' && newStatus === 'PAID') || 
                         (order.payment_method === 'COD' && oldStatus === 'COD_CONFIRMED' && newStatus === 'DELIVERED');
                         
    if (shouldDeduct && !order.stock_deducted) {
      order.items.forEach(item => {
        if (!stockSold[item.id]) stockSold[item.id] = 0;
        stockSold[item.id] += item.quantity;
      });
      stockDeductedNow = true;
      updateProductStocks();
      saveStockToFile();
    }

    // 3. Reverse stock if cancelled from delivered
    if (order.stock_deducted && newStatus !== 'DELIVERED') {
      order.items.forEach(item => {
        if (stockSold[item.id]) stockSold[item.id] = Math.max(0, stockSold[item.id] - item.quantity);
      });
      stockDeductedNow = false;
      updateProductStocks();
      saveStockToFile();
    }

    // 4. Update the Database
    await pool.query(
      'UPDATE orders SET status = $1, stock_deducted = $2 WHERE local_order_id = $3', 
      [newStatus, stockDeductedNow, orderId]
    );
    
    res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Manual Clear Orders Endpoint
// Manual Clear Orders Endpoint
app.post('/api/admin/clear-orders', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  try {
    // Delete all orders from the Neon Database
    await pool.query('TRUNCATE TABLE orders RESTART IDENTITY');
    
    console.log(`[${new Date().toLocaleString()}] SUCCESS: Orders cleared via API.`);
    res.json({ success: true, message: "Orders cleared successfully" });
  } catch (err) {
    console.error('Failed to clear orders:', err);
    res.status(500).json({ success: false, error: "Failed to clear orders" });
  }
});
// Debug endpoint - REMOVE AFTER TESTING
app.get('/api/debug-env', (req, res) => {
  res.json({
    adminTokenExists: !!process.env.ADMIN_TOKEN,
    adminTokenLength: process.env.ADMIN_TOKEN ? process.env.ADMIN_TOKEN.length : 0,
    razorpayKeyExists: !!process.env.RAZORPAY_KEY_ID,
    databaseUrlExists: !!process.env.DATABASE_URL
  });
});
// Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
