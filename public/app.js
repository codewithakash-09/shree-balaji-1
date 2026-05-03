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

function updatePageTitle(productName) {
  if (productName) {
    document.title = `${productName} - Shree Balaji Traders | Fresh Fruits & Vegetables Near Me`;
  } else {
    document.title = "Shree Balaji Traders | Fresh Fruits & Vegetables Near Me";
  }
}

function getDefaultQty(unit) {
  if (unit.includes('kg')) return 1;
  if (unit.includes('g') || unit.includes('100g') || unit.includes('250g')) return 1;
  if (unit.includes('pc') || unit.includes('pkt')) return 1;
  return 1;
}

function getQuantityOptions(unit) {
  if (unit === 'kg') {
    return [0.25, 0.5, 1, 1.5, 2, 3, 5];
  } else if (unit === '500g') {
    return [0.5, 1, 1.5, 2];
  } else if (unit === '250g') {
    return [0.5, 1, 2, 3, 4];
  } else if (unit === '100g') {
    return [0.5, 1, 2, 3, 4, 5];
  } else if (unit === '12pc') {
    return [0.5, 1, 2];
  } else if (unit === 'pkt') {
    return [1, 2, 3];
  }
  return [1, 2, 3];
}

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
    console.log('Fetching products from /api/products...');
    const res = await fetch('/api/products');
    console.log('Response status:', res.status);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    console.log('Received data type:', Array.isArray(data) ? 'Array' : typeof data);
    console.log('Products count:', data.length || 0);
    
    products = data;
    renderProducts();
    updateCartUI();
    updatePageTitle();
  } catch (error) {
    console.error('Failed to load products:', error);
    DOM.productsContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.5;"></i>
        <p>Failed to load products. Please refresh the page.</p>
        <p style="font-size: 0.8rem; margin-top: 10px; color: #c62828;">Error: ${error.message}</p>
        <p style="font-size: 0.7rem; margin-top: 5px;">Check that the server is running and API endpoint is accessible.</p>
      </div>`;
  }
}

function setCategory(cat, el) {
  currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
  if (el) el.classList.add('active');
  renderProducts();
  updatePageTitle(`${cat} Category`);
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
    if (searchTerm) {
      updatePageTitle(`Search: ${searchTerm}`);
    }
  } else {
    DOM.productsContainer.innerHTML = filtered.map(p => {
      const options = getQuantityOptions(p.unit);
      const defaultQty = options[0];
      const defaultPrice = (p.price * defaultQty).toFixed(2);
      const isOutOfStock = p.stock === false;
      return `
      <div class="product-card" data-product-name="${p.name}" data-product-id="${p.id}" style="${isOutOfStock ? 'opacity: 0.7;' : ''}">
        ${isOutOfStock ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}
        <img src="${p.image}" 
             alt="${p.name}" 
             loading="lazy"
             onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
        <div class="product-info">
          <h3>${p.name}</h3>
          <div class="price">₹<span id="price_${p.id}">${defaultPrice}</span> <span id="unit_${p.id}">/${p.unit}</span></div>
          <div class="qty-selector">
            <select class="qty-dropdown" id="qty_${p.id}" onchange="updateProductPrice(${p.id}, ${p.price}, this.value)" ${isOutOfStock ? 'disabled' : ''}>
              ${options.map(val => {
                let label = '';
                if (p.unit === 'kg' && val >= 1) label = `${val} kg`;
                else if (p.unit === 'kg' && val < 1) label = `${val * 1000}g`;
                else if (p.unit === '500g' && val === 0.5) label = '250g';
                else if (p.unit === '500g') label = `${val * 500}g`;
                else if (p.unit === '250g' && val === 0.5) label = '125g';
                else if (p.unit === '250g') label = `${val * 250}g`;
                else if (p.unit === '100g' && val === 0.5) label = '50g';
                else if (p.unit === '100g') label = `${val * 100}g`;
                else if (p.unit === '12pc' && val === 0.5) label = '6 pieces';
                else if (p.unit === '12pc') label = `${val * 12} pieces`;
                else label = `${val} ${p.unit}`;
                return `<option value="${val}">${label}</option>`;
              }).join('')}
            </select>
            ${isOutOfStock ? 
              '<button class="btn-add" style="background: #ccc; cursor: not-allowed;" disabled>Out of Stock</button>' : 
              `<button class="btn-add" onclick="addToCart(${p.id})">Add to Cart</button>`
            }
          </div>
        </div>
      </div>
    `}).join('');
  }
  
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      const productName = card.getAttribute('data-product-name');
      if (productName) {
        updatePageTitle(productName);
      }
    });
  });
}

function updateProductPrice(productId, unitPrice, selectedQty) {
  const priceElement = document.getElementById(`price_${productId}`);
  const unitElement = document.getElementById(`unit_${productId}`);
  
  if (priceElement) {
    const totalPrice = (unitPrice * parseFloat(selectedQty)).toFixed(2);
    priceElement.textContent = totalPrice;
  }
  
  const product = products.find(p => p.id === productId);
  if (unitElement && product) {
    const qty = parseFloat(selectedQty);
    let unitDisplay = '';
    
    if (product.unit === 'kg') {
      unitDisplay = qty >= 1 ? `/${qty} kg` : `/${qty * 1000}g`;
    } else if (product.unit === '500g') {
      if (qty === 0.5) unitDisplay = '/250g';
      else if (qty === 1) unitDisplay = '/500g';
      else if (qty === 1.5) unitDisplay = '/750g';
      else if (qty === 2) unitDisplay = '/1kg';
      else unitDisplay = `/${qty * 500}g`;
    } else if (product.unit === '250g') {
      if (qty === 0.5) unitDisplay = '/125g';
      else if (qty === 1) unitDisplay = '/250g';
      else if (qty === 2) unitDisplay = '/500g';
      else if (qty === 3) unitDisplay = '/750g';
      else if (qty === 4) unitDisplay = '/1kg';
      else unitDisplay = `/${qty * 250}g`;
    } else if (product.unit === '100g') {
      if (qty === 0.5) unitDisplay = '/50g';
      else if (qty === 1) unitDisplay = '/100g';
      else if (qty === 2) unitDisplay = '/200g';
      else if (qty === 3) unitDisplay = '/300g';
      else if (qty === 4) unitDisplay = '/400g';
      else if (qty === 5) unitDisplay = '/500g';
      else unitDisplay = `/${qty * 100}g`;
    } else if (product.unit === '12pc') {
      if (qty === 0.5) unitDisplay = '/6 pieces';
      else if (qty === 1) unitDisplay = '/12 pieces';
      else if (qty === 2) unitDisplay = '/24 pieces';
      else unitDisplay = `/${qty * 12} pieces`;
    } else {
      unitDisplay = `/${qty} ${product.unit}`;
    }
    
    unitElement.textContent = unitDisplay;
  }
}

function addToCart(id) {
  const qtySelect = document.getElementById(`qty_${id}`);
  const selectedQty = qtySelect ? parseFloat(qtySelect.value) : 1;
  
  const product = products.find(p => p.id === id);
  if (!product) return;
  
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.quantity += selectedQty;
  } else {
    cart.push({ id: id, quantity: selectedQty });
  }
  saveCart(); 
  toggleCart(true);
}
function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  saveCart();
}

function saveCart() { 
  localStorage.setItem('sbt_cart', JSON.stringify(cart)); 
  updateCartUI(); 
}

// SINGLE updateCartItemQuantity function (removed duplicate)
function updateCartItemQuantity(productId, newValue) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  let newQuantity;
  
  // newValue is in grams for weight-based products
  // Convert grams back to the product's unit
  if (product.unit === 'kg') {
    newQuantity = newValue / 1000;  // 500g → 0.5 kg, 2000g → 2 kg
  } else if (product.unit === '500g') {
    newQuantity = newValue / 500;   // 250g → 0.5, 500g → 1, 1000g → 2
  } else if (product.unit === '250g') {
    newQuantity = newValue / 250;   // 125g → 0.5, 250g → 1, 500g → 2
  } else if (product.unit === '100g') {
    newQuantity = newValue / 100;   // 50g → 0.5, 100g → 1, 200g → 2
  } else if (product.unit === '12pc') {
    // newValue is already the multiplier (0.5 = 6 pieces, 1 = 12 pieces)
    newQuantity = newValue;
  } else if (product.unit === 'pkt') {
    // newValue is number of packets
    newQuantity = newValue;
  } else {
    newQuantity = newValue;
  }

  // Validate minimum quantity
  if (newQuantity < 0.01) newQuantity = 0.01;

  const cartItem = cart.find(item => item.id === productId);
  if (cartItem) {
    cartItem.quantity = parseFloat(newQuantity.toFixed(3));
  }
  
  saveCart();
}
function updateCartUI() {
  let total = 0, count = 0, html = '';
  
  cart.forEach(item => {
    const p = products.find(p => p.id === item.id);
    if (!p) return;

    let unitMultiplier = 1;
    let baseUnit = p.unit;
    
    if (p.unit === 'kg') {
      unitMultiplier = 1000;
      baseUnit = 'g';
    } else if (p.unit === '500g') {
      unitMultiplier = 500;
      baseUnit = 'g';
    } else if (p.unit === '250g') {
      unitMultiplier = 250;
      baseUnit = 'g';
    } else if (p.unit === '100g') {
      unitMultiplier = 100;
      baseUnit = 'g';
    } else if (p.unit === '12pc') {
      baseUnit = 'pieces';
    } else if (p.unit === 'pkt') {
      baseUnit = 'pkt';
    }

    let currentQtyInGrams = item.quantity;
    if (p.unit === 'kg') currentQtyInGrams = item.quantity * 1000;
    else if (p.unit === '500g') currentQtyInGrams = item.quantity * 500;
    else if (p.unit === '250g') currentQtyInGrams = item.quantity * 250;
    else if (p.unit === '100g') currentQtyInGrams = item.quantity * 100;

    let optionsHtml = '';
    
    if (p.unit === '12pc') {
      const pieceOptions = [6, 12, 18, 24];
      optionsHtml = pieceOptions.map(pcs => {
        const isSelected = Math.abs(item.quantity * 12 - pcs) < 0.01;
        return `<option value="${pcs / 12}" ${isSelected ? 'selected' : ''}>${pcs} pieces</option>`;
      }).join('');
      baseUnit = 'pieces';
    } else if (p.unit === 'pkt') {
      const pktOptions = [1, 2, 3, 5];
      optionsHtml = pktOptions.map(pkts => {
        const isSelected = Math.abs(item.quantity - pkts) < 0.01;
        return `<option value="${pkts}" ${isSelected ? 'selected' : ''}>${pkts} packet${pkts > 1 ? 's' : ''}</option>`;
      }).join('');
      baseUnit = 'pkt';
    } else {
      const gramOptions = [50, 100, 250, 500, 1000];
      optionsHtml = gramOptions.map(gram => {
        const isSelected = Math.abs(currentQtyInGrams - gram) < 0.01;
        return `<option value="${gram}" ${isSelected ? 'selected' : ''}>${gram}g</option>`;
      }).join('');
    }

    const itemTotal = p.price * (currentQtyInGrams / (p.unit === 'kg' ? 1000 : (unitMultiplier > 1 ? unitMultiplier : 1)));
    total += itemTotal;
    count += item.quantity;

    let displayQty = '';
    if (p.unit === 'kg') {
      displayQty = item.quantity >= 1 ? `${item.quantity} kg` : `${item.quantity * 1000}g`;
    } else if (p.unit === '500g') {
      displayQty = `${item.quantity * 500}g`;
    } else if (p.unit === '250g') {
      displayQty = `${item.quantity * 250}g`;
    } else if (p.unit === '100g') {
      displayQty = `${item.quantity * 100}g`;
    } else {
      displayQty = `${item.quantity} ${p.unit}`;
    }

    html += `
      <div class="cart-item" data-product-id="${p.id}">
        <div class="cart-item-details">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <h4 style="flex: 1;">${p.name}</h4>
            <button onclick="removeFromCart(${p.id})" style="background: none; border: none; color: #ff5722; cursor: pointer; font-size: 1.2rem; padding: 0 5px;" title="Remove item">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
          <div style="color:var(--primary); font-weight:bold;">₹${p.price} / ${p.unit}</div>
          <div style="font-size: 0.85rem; color: #666;">Current: ${displayQty}</div>
          <div class="qty-controls" style="display: flex; gap: 10px; align-items: center; margin-top: 8px;">
            <select class="cart-qty-select" data-product-id="${p.id}" style="padding: 6px; border-radius: 6px; border: 1px solid #ddd;">
              ${optionsHtml}
            </select>
            <span style="color: #666;">${baseUnit === 'g' ? 'g' : baseUnit}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <button onclick="removeFromCart(${p.id})" style="background: #ffebee; color: #c62828; border: 1px solid #ffcdd2; padding: 3px 10px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-family: 'Poppins', sans-serif;">
              🗑️ Remove
            </button>
            <span style="font-weight: bold; color: #ff5722;">₹${itemTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>`;
  });

  DOM.cartItems.innerHTML = html || '<p style="text-align:center;padding:20px;color:#666;">🛒 Cart is empty</p>';
  DOM.cartTotal.innerText = `₹${total.toFixed(2)}`;
  DOM.cartCount.innerText = Math.round(count * 100) / 100;
  DOM.checkoutBtn.disabled = total < 200;
  DOM.minOrderWarning.innerText = total < 200 ? `Add ₹${(200 - total).toFixed(2)} more for min order` : "✅ Free Delivery!";

  document.querySelectorAll('.cart-qty-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const productId = parseInt(e.target.getAttribute('data-product-id'));
      const newValue = parseFloat(e.target.value);
      updateCartItemQuantity(productId, newValue);
    });
  });
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

// Keep your existing trackOrder, retryPayment, order history functions here...
// (They remain unchanged from your original file)

function openTrackModal() {
  document.getElementById('trackModal').classList.add('show');
  updatePageTitle('Track Your Order');
}

function closeTrackModal() {
  document.getElementById('trackModal').classList.remove('show');
  document.getElementById('trackResult').innerHTML = '';
  document.getElementById('trackOrderId').value = '';
  updatePageTitle();
}

async function retryPayment(orderId) {
  try {
    const response = await fetch('/api/checkout/retry-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localOrderId: orderId })
    });
    const data = await response.json();
    if (data.success) {
      const options = {
        key: data.key_id,
        amount: data.amount,
        currency: "INR",
        name: "Shree Balaji Traders",
        order_id: data.razorpay_order_id,
        handler: async (response) => {
          const verifyRes = await fetch('/api/checkout/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localOrderId: orderId, ...response })
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            window.location.href = `success.html?id=${orderId}`;
          } else {
            alert("Payment verification failed. Please contact support.");
          }
        }
      };
      new Razorpay(options).open();
    } else {
      alert(data.error || "Failed to retry payment");
    }
  } catch (err) {
    alert("Something went wrong. Please contact support.");
  }
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
          <p><strong>💰 Amount:</strong> ₹${order.total_amount}</p>
          <p><strong>💳 Payment:</strong> ${order.payment_method === 'COD' ? 'Cash on Delivery' : 'Online Payment'}</p>
          <p><strong>👤 Customer:</strong> ${order.customer_name}</p>
          <p><strong>📍 Address:</strong> ${order.address}</p>
          <p><strong>📞 Phone:</strong> ${order.phone}</p>
        </div>
        <div style="background: white; padding: 12px; border-radius: 8px; margin-top: 15px;">
          <strong>🛒 Items Ordered:</strong>
          <ul style="margin-top: 8px; margin-left: 20px;">
            ${order.items.map(item => `<li>${item.name} x${item.quantity} = ₹${item.price * item.quantity}</li>`).join('')}
          </ul>
          ${order.notes ? `<div style="margin-top: 10px; padding: 8px; background: #fff3e0; border-radius: 6px;"><strong>📝 Special Request:</strong> ${order.notes}</div>` : ''}
        </div>
        ${order.status === 'PENDING' && order.payment_method === 'ONLINE' ? `
          <div style="margin-top: 15px; text-align: center;">
            <button onclick="retryPayment('${order.id}')" style="background: #ff5722; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600; width: 100%;">
              🔄 Retry Payment
            </button>
            <p style="font-size: 0.75rem; color: #666; margin-top: 8px;">Your payment failed or was cancelled. Click to try again.</p>
          </div>
        ` : ''}
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

function openHistoryModal() {
  document.getElementById('historyModal').classList.add('show');
  updatePageTitle('Order History');
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('show');
  document.getElementById('historyResult').innerHTML = '';
  document.getElementById('historyPhone').value = '';
  updatePageTitle();
}

async function fetchOrderHistory() {
  const phone = document.getElementById('historyPhone').value.trim();
  const resultDiv = document.getElementById('historyResult');
  
  if (!phone || phone.length !== 10) {
    resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">⚠️ Please enter a valid 10-digit phone number</div>';
    return;
  }
  
  resultDiv.innerHTML = '<div style="text-align: center; padding: 20px;">⏳ Searching your orders...</div>';
  
  try {
    const response = await fetch(`/api/order-history/${phone}`);
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">❌ No orders found for this phone number.</div>';
      return;
    }
    
    const orders = data.orders;
    
    if (orders.length === 0) {
      resultDiv.innerHTML = '<div style="background: #fff3e0; padding: 15px; border-radius: 8px; color: #e65100;">📭 No orders found for this phone number.</div>';
      return;
    }
    
    let html = `<p style="font-weight: bold; margin-bottom: 15px;">📋 Found ${orders.length} order(s):</p>`;
    
    orders.forEach(order => {
      const statusColors = {
        'PENDING': '#ff9800',
        'PAID': '#4caf50',
        'COD_CONFIRMED': '#2196f3',
        'PROCESSING': '#9c27b0',
        'SHIPPED': '#ff5722',
        'DELIVERED': '#2e7d32'
      };
      
      html += `
        <div style="background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 0.9rem;">📦 ${order.id}</strong>
            <span style="background: ${statusColors[order.status] || '#666'}; color: white; padding: 3px 10px; border-radius: 15px; font-size: 0.75rem; font-weight: 600;">${order.status}</span>
          </div>
          <p style="font-size: 0.8rem; color: #666;">📅 ${new Date(order.created_at).toLocaleString()}</p>
          <p style="font-size: 0.85rem; font-weight: bold; color: #2e7d32;">💰 ₹${order.total_amount} (${order.payment_method})</p>
          <button onclick="trackSpecificOrder('${order.id}')" style="background: #ff5722; color: white; border: none; padding: 6px 15px; border-radius: 20px; font-size: 0.75rem; cursor: pointer; margin-top: 8px; width: auto;">
            📍 Track This Order
          </button>
        </div>
      `;
    });
    
    resultDiv.innerHTML = html;
  } catch (error) {
    resultDiv.innerHTML = '<div style="background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828;">❌ Server error. Please try again later.</div>';
  }
}

function trackSpecificOrder(orderId) {
  closeHistoryModal();
  setTimeout(() => {
    openTrackModal();
    document.getElementById('trackOrderId').value = orderId;
    trackOrder();
  }, 300);
}

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

init();
