require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// JSON File Storage (Replaces PostgreSQL)
// ==========================================
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Load orders from file if exists
let orders = [];
if (fs.existsSync(ORDERS_FILE)) {
  try {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    orders = JSON.parse(data);
    console.log(`✅ Loaded ${orders.length} orders from file`);
  } catch (err) {
    console.error('❌ Error loading orders file:', err);
    orders = [];
  }
}

// Helper to save orders to file
function saveOrdersToFile() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('❌ Error saving orders to file:', err);
  }
}

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
  { id: 1, name: "Apple Kinnaur (Big)", price: 180, unit: "kg", category: "Fruits", stock: false, image: "https://imgs.search.brave.com/_JzNpY0LelznPiCiLcw1KoYrQhfD6hJegbOuiR8kt2w/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly81Lmlt/aW1nLmNvbS9kYXRh/NS9TRUxMRVIvRGVm/YXVsdC8yMDIzLzEv/U08vSUcvSFovNDUx/MTcxOTIvZnJlc2gt/a2lubmF1ci1hcHBs/ZS01MDB4NTAwLmpw/ZWc" },
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

// ==========================================
// API Routes
// ==========================================

app.get('/api/products', (req, res) => res.json({ success: true, products }));

app.post('/api/checkout/create-order', async (req, res) => {
  try {
    const { customer, items, paymentMethod, notes } = req.body;
    
    if (!items || items.length === 0) return res.status(400).json({ error: "Cart is empty" });
    const { total, verifiedItems } = calculateSecureTotal(items);
    if (total < 200) return res.status(400).json({ error: "Minimum order is ₹200" });

    const localOrderId = `SBT_${nanoid(8)}`;
    const method = paymentMethod === 'COD' ? 'COD' : 'ONLINE';
    const customerNotes = notes || '';

    // Handle COD
    if (method === 'COD') {
      orders.push({
        id: localOrderId,
        status: 'COD_CONFIRMED',
        amount_inr: total,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_address: customer.address,
        items_json: JSON.stringify(verifiedItems),
        razorpay_order_id: null,
        razorpay_payment_id: null,
        payment_method: 'COD',
        notes: customerNotes,
        created_at: new Date().toISOString()
      });
      saveOrdersToFile();
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

    orders.push({
      id: localOrderId,
      status: 'PENDING',
      amount_inr: total,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_address: customer.address,
      items_json: JSON.stringify(verifiedItems),
      razorpay_order_id: rpOrder.id,
      razorpay_payment_id: null,
      payment_method: 'ONLINE',
      notes: customerNotes,
      created_at: new Date().toISOString()
    });
    saveOrdersToFile();

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
      const order = orders.find(o => o.id === localOrderId);
      if (order) {
        order.status = 'PAID';
        order.razorpay_payment_id = razorpay_payment_id;
        saveOrdersToFile();
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

// Secure Admin Panel Data Route
app.get('/api/admin/orders', async (req, res) => {
  const token = req.header('X-Admin-Token');
  const realPassword = process.env.ADMIN_TOKEN;

  if (!realPassword || token !== realPassword) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const formattedOrders = [...orders]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(order => ({
        ...order,
        items: JSON.parse(order.items_json)
      }));

    res.json({ success: true, orders: formattedOrders });
  } catch (err) {
    console.error("Admin Error:", err);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});

// Order Tracking API
app.get('/api/track-order/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  
  try {
    const order = orders.find(o => o.id === orderId);
    
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
// Order History API (by phone number)
app.get('/api/order-history/:phone', async (req, res) => {
  const phone = req.params.phone;
  
  try {
    const customerOrders = orders.filter(o => o.customer_phone === phone);
    
    const formattedOrders = customerOrders
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(order => ({
        ...order,
        items: JSON.parse(order.items_json)
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
  
  if (adminKey !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const validStatuses = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COD_CONFIRMED'];
  if (!validStatuses.includes(newStatus)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  
  try {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    order.status = newStatus;
    saveOrdersToFile();
    res.json({ success: true, message: "Status updated" });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Manual Clear Orders Endpoint
app.post('/api/admin/clear-orders', async (req, res) => {
  const token = req.header('X-Admin-Token');
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  
  try {
    orders.length = 0; // Clear the array
    saveOrdersToFile(); // Save empty array to file
    console.log(`[${new Date().toLocaleString()}] SUCCESS: Orders cleared via API.`);
    res.json({ success: true, message: "Orders cleared successfully" });
  } catch (err) {
    console.error('Failed to clear orders:', err);
    res.status(500).json({ success: false, error: "Failed to clear orders" });
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
