let products = [];
let cart = JSON.parse(localStorage.getItem('sbt_cart') || '[]');
let currentCategory = 'All';

const DOM = {
  productsContainer: document.getElementById('productsContainer'),
  cartSidebar: document.getElementById('cartSidebar'),
  cartOverlay: document.getElementById('cartOverlay'),
  cartItems: document.getElementById('cartItems'),
  cartTotal: document.getElementById('cartTotal'),
  cartCount: document.getElementById('cartCount'),
  checkoutBtn: document.getElementById('checkoutBtn'),
  minOrderWarning: document.getElementById('minOrderWarning'),
  customerModal: document.getElementById('customerModal'),
  customerForm: document.getElementById('customerForm'),
  payBtn: document.getElementById('payBtn')
};

// Create a simple fallback image as a constant
const FALLBACK_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect fill="#e8f5e9" width="200" height="200"/>
    <text x="50%" y="40%" dominant-baseline="middle" text-anchor="middle" fill="#2e7d32" font-size="40" font-family="Arial">🥬</text>
    <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="#2e7d32" font-size="16" font-family="Arial">Fresh</text>
    <text x="50%" y="75%" dominant-baseline="middle" text-anchor="middle" fill="#2e7d32" font-size="16" font-family="Arial">Produce</text>
  </svg>
`);

async function init() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    products = data.products;
    renderProducts();
    updateCartUI();
  } catch (error) {
    console.error('Failed to load products:', error);
    DOM.productsContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.5;"></i>
        <p>Failed to load products. Please refresh the page.</p>
      </div>`;
  }
}

function setCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderProducts();
}

function filterProducts() {
  renderProducts();
}

function renderProducts() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;
  const searchTerm = searchInput.value.toLowerCase().trim();

  const filtered = products.filter(p => {
    const matchesCat = currentCategory === 'All' || p.category === currentCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm);
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    DOM.productsContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">
        <i class="fas fa-search" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.3;"></i>
        <p>No products found for "${searchTerm}"</p>
      </div>`;
  } else {
    DOM.productsContainer.innerHTML = filtered.map(p => `
      <div class="product-card">
        <img src="${p.image}" 
             alt="${p.name}" 
             loading="lazy"
             onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
        <div class="product-info">
          <h3>${p.name}</h3>
          <div class="price">₹${p.price} <span>/${p.unit}</span></div>
          <button class="btn-add" onclick="addToCart(${p.id})">Add to Cart</button>
        </div>
      </div>
    `).join('');
  }
}

function addToCart(id) {
  const existing = cart.find(item => item.id === id);
  if (existing) existing.quantity++; 
  else cart.push({ id, quantity: 1 });
  saveCart(); 
  toggleCart(true);
}

function updateQty(id, change) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.quantity += change;
  if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);
  saveCart();
}

function saveCart() { 
  localStorage.setItem('sbt_cart', JSON.stringify(cart)); 
  updateCartUI(); 
}

function updateCartUI() {
  let total = 0, count = 0, html = '';
  cart.forEach(item => {
    const p = products.find(p => p.id === item.id);
    if (!p) return;
    total += p.price * item.quantity; 
    count += item.quantity;
    html += `
      <div class="cart-item">
        <div class="cart-item-details">
          <h4>${p.name}</h4>
          <div style="color:var(--primary); font-weight:bold;">₹${p.price} / ${p.unit}</div>
          <div class="qty-controls">
            <button onclick="updateQty(${p.id}, -1)">-</button>
            <span>${item.quantity}</span>
            <button onclick="updateQty(${p.id}, 1)">+</button>
          </div>
        </div>
      </div>`;
  });
  DOM.cartItems.innerHTML = html || '<p style="text-align:center;padding:20px;color:#666;">🛒 Cart is empty</p>';
  DOM.cartTotal.innerText = `₹${total}`;
  DOM.cartCount.innerText = count;
  DOM.checkoutBtn.disabled = total < 200;
  DOM.minOrderWarning.innerText = total < 200 ? `Add ₹${200 - total} more for min order` : "✅ Free Delivery!";
}

function toggleCart(forceOpen = false) {
  const isOpen = DOM.cartSidebar.classList.contains('open');
  if (isOpen && !forceOpen) { 
    DOM.cartSidebar.classList.remove('open'); 
    DOM.cartOverlay.classList.remove('show'); 
  } else { 
    DOM.cartSidebar.classList.add('open'); 
    DOM.cartOverlay.classList.add('show'); 
  }
}

function openCustomerModal() { 
  toggleCart(); 
  DOM.customerModal.classList.add('show'); 
}

function closeCustomerModal() { 
  DOM.customerModal.classList.remove('show'); 
}

DOM.customerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  DOM.payBtn.disabled = true; 
  DOM.payBtn.innerText = "⏳ Processing...";

  const customer = {
    name: document.getElementById('custName').value,
    phone: document.getElementById('custPhone').value,
    address: document.getElementById('custAddress').value
  };
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
  const notes = document.getElementById('customRequest').value;

  try {
    const res = await fetch('/api/checkout/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items: cart, paymentMethod, notes })
    });
    const orderData = await res.json();
    
    if (orderData.isCOD) {
      cart = []; 
      saveCart();
      window.location.href = `success.html?id=${orderData.localOrderId}`;
    } else {
      const options = {
        key: orderData.key_id, 
        amount: orderData.amount, 
        currency: "INR",
        name: "Shree Balaji Traders", 
        order_id: orderData.razorpay_order_id,
        prefill: { name: customer.name, contact: customer.phone },
        handler: async (response) => {
          const verifyRes = await fetch('/api/checkout/verify', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localOrderId: orderData.localOrderId, ...response })
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) { 
            cart = []; 
            saveCart(); 
            window.location.href = `success.html?id=${orderData.localOrderId}`; 
          }
        }
      };
      new Razorpay(options).open();
    }
  } catch (err) { 
    alert("❌ Checkout failed. Please try again."); 
    DOM.payBtn.disabled = false; 
    DOM.payBtn.innerText = "Place Order";
  }
});

// Track Order Functions
function openTrackModal() {
  document.getElementById('trackModal').classList.add('show');
}

function closeTrackModal() {
  document.getElementById('trackModal').classList.remove('show');
  document.getElementById('trackResult').innerHTML = '';
  document.getElementById('trackOrderId').value = '';
}

async function trackOrder() {
  const orderId = document.getElementById('trackOrderId').value.trim();
  const resultDiv = document.getElementById('trackResult');
  
  if (!orderId) {
    resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">⚠️ Please enter your Order ID</div>';
    return;
  }
  
  resultDiv.innerHTML = '<div style="text-align: center; padding: 20px;">⏳ Checking order status...</div>';
  
  try {
    const response = await fetch(`/api/track-order/${orderId}`);
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">❌ Order not found. Please check your Order ID and try again.</div>';
      return;
    }
    
    const order = data.order;
    
    const statusConfig = {
      'PAID': { text: '✅ Payment Confirmed', color: '#2e7d32', bg: '#e8f5e9' },
      'COD_CONFIRMED': { text: '✅ Order Confirmed (COD)', color: '#2e7d32', bg: '#e8f5e9' },
      'PENDING': { text: '⏳ Payment Pending', color: '#ff9800', bg: '#fff3e0' },
      'PROCESSING': { text: '🔄 Processing', color: '#2196f3', bg: '#e3f2fd' },
      'SHIPPED': { text: '🚚 Out for Delivery', color: '#ff5722', bg: '#fff3e0' },
      'DELIVERED': { text: '✔️ Delivered', color: '#4caf50', bg: '#e8f5e9' }
    };
    
    const config = statusConfig[order.status] || { text: order.status, color: '#666', bg: '#f5f5f5' };
    
    resultDiv.innerHTML = `
      <div style="background: ${config.bg}; padding: 20px; border-radius: 12px; margin-top: 10px;">
        <div style="text-align: center; margin-bottom: 15px;">
          <h3 style="color: ${config.color}; margin-top: 10px;">${config.text}</h3>
        </div>
        
        <div style="border-top: 1px solid #ddd; padding-top: 15px; margin-top: 10px;">
          <p><strong>📦 Order ID:</strong> ${order.id}</p>
          <p><strong>📅 Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
          <p><strong>💰 Amount:</strong> ₹${order.amount_inr}</p>
          <p><strong>💳 Payment:</strong> ${order.payment_method === 'COD' ? 'Cash on Delivery' : 'Online Payment'}</p>
          <p><strong>👤 Customer:</strong> ${order.customer_name}</p>
          <p><strong>📍 Address:</strong> ${order.customer_address}</p>
          <p><strong>📞 Phone:</strong> ${order.customer_phone}</p>
        </div>
        
        <div style="background: white; padding: 12px; border-radius: 8px; margin-top: 15px;">
          <strong>🛒 Items Ordered:</strong>
          <ul style="margin-top: 8px; margin-left: 20px;">
            ${order.items.map(item => `<li>${item.name} x${item.quantity} = ₹${item.price * item.quantity}</li>`).join('')}
          </ul>
          ${order.notes ? `<div style="margin-top: 10px; padding: 8px; background: #fff3e0; border-radius: 6px;"><strong>📝 Special Request:</strong> ${order.notes}</div>` : ''}
        </div>
        
        <div style="margin-top: 15px; text-align: center; padding-top: 10px; border-top: 1px solid #ddd;">
          <a href="tel:+917398958319" style="display: inline-block; margin: 5px; padding: 8px 15px; background: #25d366; color: white; text-decoration: none; border-radius: 20px; font-size: 0.85rem;">
            💬 Chat on WhatsApp
          </a>
          <a href="tel:+917398958319" style="display: inline-block; margin: 5px; padding: 8px 15px; background: #ff5722; color: white; text-decoration: none; border-radius: 20px; font-size: 0.85rem;">
            📞 Call Support
          </a>
        </div>
      </div>
    `;
  } catch (error) {
    resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">❌ Server error. Please try again later.</div>';
  }
}

// Auto-open track modal if URL contains ?track=ORDERID
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const trackId = urlParams.get('track');
  if (trackId) {
    setTimeout(() => {
      openTrackModal();
      document.getElementById('trackOrderId').value = trackId;
      trackOrder();
      window.history.replaceState({}, '', '/');
    }, 500);
  }
  
  const storedTrackId = sessionStorage.getItem('track_order_id');
  if (storedTrackId && !trackId) {
    setTimeout(() => {
      openTrackModal();
      document.getElementById('trackOrderId').value = storedTrackId;
      trackOrder();
      sessionStorage.removeItem('track_order_id');
    }, 500);
  }
});

// Initialize the app
init();
