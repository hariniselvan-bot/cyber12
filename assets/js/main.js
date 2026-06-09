/**
 * Stackly - Main JavaScript
 * 3D Network Visualization, Animations, Auth System
 */

// ========================================
// Authentication System
// ========================================
const Auth = {
  init() {
    // Check if user is logged in
    const user = this.getUser();
    if (user) {
      this.updateUIForLoggedInUser(user);
    }
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('stackly_user'));
    } catch {
      return null;
    }
  },

  setUser(user) {
    localStorage.setItem('stackly_user', JSON.stringify(user));
  },

  clearUser() {
    localStorage.removeItem('stackly_user');
  },

  isLoggedIn() {
    return !!this.getUser();
  },

  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },

  login(email, password, role = 'user') {
    // Simulate login - in production this would be an API call
    const mockUsers = {
      'admin@stackly.com': { name: 'Admin User', role: 'admin' },
      'user@stackly.com': { name: 'Demo User', role: 'user' }
    };

    // For demo, accept any email/password with the role
    const user = mockUsers[email] || { name: email.split('@')[0], role: role };
    user.email = email;
    user.loginTime = new Date().toISOString();

    this.setUser(user);
    return user;
  },

  register(name, email, password, role = 'user') {
    const user = { name, email, role, loginTime: new Date().toISOString() };
    this.setUser(user);
    return user;
  },

  logout() {
    this.clearUser();
    window.location.href = 'index.html';
  },

  updateUIForLoggedInUser(user) {
    // Update navbar if it has auth elements
    const authSection = document.querySelector('.navbar-auth');
    if (authSection) {
      authSection.innerHTML = `
        <span style="font-size:13px;color:var(--gray);">${user.name}</span>
        <button onclick="Auth.logout()" class="btn btn-sm btn-outline" style="color:var(--dark);border-color:var(--border);">Logout</button>
      `;
    }
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  requireAdmin() {
    if (!this.isLoggedIn() || !this.isAdmin()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }
};

// ========================================
// 3D Network Visualization
// ========================================
const Network3D = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  nodes: [],
  connections: [],
  packets: [],
  packetPool: [],
  raycaster: null,
  mouse: null,
  selectedNode: null,
  selectionRing: null,
  composer: null,
  bloomPass: null,
  isRunning: false,
  lastPacketTime: 0,
  autoRotatePaused: false,
  autoRotatePauseTimer: null,

  init() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.02);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 18);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.8;

    // Raycaster and mouse for interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Pause auto-rotate on interaction
    this.controls.addEventListener('start', () => {
      this.autoRotatePaused = true;
      if (this.autoRotatePauseTimer) clearTimeout(this.autoRotatePauseTimer);
    });
    this.controls.addEventListener('end', () => {
      this.autoRotatePauseTimer = setTimeout(() => {
        this.autoRotatePaused = false;
      }, 5000);
    });

    // Post-processing (Bloom)
    try {
      this.composer = new THREE.EffectComposer(this.renderer);
      this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.6,  // strength
        0.8,  // radius
        0.3   // threshold
      );
      this.composer.addPass(this.bloomPass);
    } catch (e) {
      console.warn('Bloom not available:', e);
      this.composer = null;
    }

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x1a56db, 0.3);
    this.scene.add(ambientLight);

    // Create network
    this.createNetwork();

    // Event listeners
    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));

    // Start loop
    this.isRunning = true;
    this.animate();
  },

  createNetwork() {
    const nodeCount = window.innerWidth < 768 ? 30 : 60;
    const colors = {
      regular: 0x1a56db,
      gateway: 0xf59e0b,
      secure: 0x0e9f6e
    };

    // Create nodes using golden angle distribution
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nodeCount; i++) {
      const t = i / (nodeCount - 1);
      const inclination = Math.acos(1 - 2 * t);
      const azimuth = goldenAngle * i;

      const radius = 6 + Math.random() * 4;
      const x = radius * Math.sin(inclination) * Math.cos(azimuth);
      const y = radius * Math.sin(inclination) * Math.sin(azimuth);
      const z = radius * Math.cos(inclination);

      let type = 'regular';
      let color = colors.regular;
      if (i < 5) {
        type = 'secure';
        color = colors.secure;
      } else if (i < 15) {
        type = 'gateway';
        color = colors.gateway;
      }

      const nodeSize = 0.3 + Math.random() * 0.2;
      const geometry = new THREE.SphereGeometry(nodeSize, 32, 32);
      const material = new THREE.MeshPhysicalMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.6,
        metalness: 0.8,
        roughness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.userData = {
        id: i,
        type: type,
        traffic: Math.random(),
        connections: [],
        originalEmissive: 0.6
      };

      // Point light for glow
      const light = new THREE.PointLight(color, 1.5, 8);
      mesh.add(light);

      this.scene.add(mesh);
      this.nodes.push(mesh);
    }

    // Create connections between nearest neighbors
    this.nodes.forEach((node, i) => {
      const distances = this.nodes
        .map((other, j) => ({
          index: j,
          mesh: other,
          distance: node.position.distanceTo(other.position)
        }))
        .filter(d => d.index !== i)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 2 + Math.floor(Math.random() * 3));

      distances.forEach(d => {
        if (!node.userData.connections.includes(d.index)) {
          node.userData.connections.push(d.index);

          // Create curved tube
          const midPoint = new THREE.Vector3()
            .addVectors(node.position, d.mesh.position)
            .multiplyScalar(0.5);
          midPoint.add(new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
          ));

          const curve = new THREE.CatmullRomCurve3([
            node.position,
            midPoint,
            d.mesh.position
          ]);

          const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.03, 8, false);
          const tubeMaterial = new THREE.MeshBasicMaterial({
            color: 0x1a56db,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          });

          const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
          tube.userData = { curve: curve, from: i, to: d.index };
          this.scene.add(tube);
          this.connections.push(tube);
        }
      });
    });

    // Initialize packet pool
    for (let i = 0; i < 50; i++) {
      const packetGeom = new THREE.SphereGeometry(0.06, 8, 8);
      const packetMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending
      });
      const packet = new THREE.Mesh(packetGeom, packetMat);
      packet.visible = false;
      this.scene.add(packet);
      this.packetPool.push({
        mesh: packet,
        active: false,
        curve: null,
        progress: 0,
        speed: 0
      });
    }

    // Selection ring
    const ringGeom = new THREE.RingGeometry(0.8, 0.9, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    this.selectionRing = new THREE.Mesh(ringGeom, ringMat);
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  },

  spawnPacket() {
    const inactive = this.packetPool.find(p => !p.active);
    if (!inactive) return;

    const connection = this.connections[Math.floor(Math.random() * this.connections.length)];
    if (!connection) return;

    inactive.active = true;
    inactive.curve = connection.userData.curve;
    inactive.progress = 0;
    inactive.speed = 0.2 + Math.random() * 0.5;
    inactive.mesh.visible = true;
  },

  updatePackets(delta) {
    this.packetPool.forEach(packet => {
      if (!packet.active) return;

      packet.progress += packet.speed * delta;
      if (packet.progress >= 1) {
        // Packet arrived - flash destination node
        packet.active = false;
        packet.mesh.visible = false;
        packet.progress = 0;
        return;
      }

      const point = packet.curve.getPoint(packet.progress);
      packet.mesh.position.copy(point);
    });
  },

  updateNodeFlashes(delta) {
    this.nodes.forEach(node => {
      if (node.material.emissiveIntensity > node.userData.originalEmissive) {
        node.material.emissiveIntensity -= delta * 3;
        if (node.material.emissiveIntensity < node.userData.originalEmissive) {
          node.material.emissiveIntensity = node.userData.originalEmissive;
        }
      }
    });
  },

  onClick(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodes);

    if (intersects.length > 0) {
      const node = intersects[0].object;
      this.selectNode(node);
    } else {
      this.deselectNode();
    }
  },

  onMouseMove(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodes);

    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'grab';
    }
  },

  selectNode(node) {
    this.selectedNode = node;

    // Show selection ring
    this.selectionRing.visible = true;
    this.selectionRing.position.copy(node.position);
    this.selectionRing.lookAt(this.camera.position);
    this.selectionRing.material.opacity = 0.8;

    // Flash node
    node.material.emissiveIntensity = 2.0;

    // Update info panel
    const panel = document.getElementById('node-info-panel');
    if (panel) {
      const typeLabels = { regular: 'Router', gateway: 'Gateway', secure: 'Endpoint' };
      panel.innerHTML = `
        <div class="node-id">Node #${node.userData.id}</div>
        <div class="node-detail"><span>Type</span><span>${typeLabels[node.userData.type]}</span></div>
        <div class="node-detail"><span>Connections</span><span>${node.userData.connections.length}</span></div>
        <div class="node-detail"><span>Traffic</span><span>${(node.userData.traffic * 2.8).toFixed(1)}K pkts/s</span></div>
        <div class="node-detail"><span>Status</span><span style="color:#0e9f6e">Healthy</span></div>
      `;
      panel.classList.add('visible');

      // Position panel near node
      const vector = node.position.clone();
      vector.project(this.camera);
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
      panel.style.left = `${x + 20}px`;
      panel.style.top = `${y - 50}px`;
    }
  },

  deselectNode() {
    this.selectedNode = null;
    this.selectionRing.visible = false;
    const panel = document.getElementById('node-info-panel');
    if (panel) panel.classList.remove('visible');
  },

  onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  },

  animate() {
    if (!this.isRunning) return;
    requestAnimationFrame(() => this.animate());

    const delta = 0.016;
    const now = Date.now();

    // Controls
    if (this.controls) {
      this.controls.autoRotate = !this.autoRotatePaused;
      this.controls.update();
    }

    // Spawn packets
    if (now - this.lastPacketTime > (50 + Math.random() * 150)) {
      this.spawnPacket();
      this.lastPacketTime = now;
    }

    // Update
    this.updatePackets(delta);
    this.updateNodeFlashes(delta);

    // Selection ring follows camera
    if (this.selectionRing && this.selectionRing.visible && this.selectedNode) {
      this.selectionRing.position.copy(this.selectedNode.position);
      this.selectionRing.lookAt(this.camera.position);
    }

    // Render
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  },

  destroy() {
    this.isRunning = false;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    if (this.controls) this.controls.dispose();
  }
};

// ========================================
// Scroll Animations (GSAP-like using IntersectionObserver)
// ========================================
const ScrollAnimations = {
  init() {
    console.log('ScrollAnimations.init() called');
    try {
      // Fade up animations
      const fadeUpElements = document.querySelectorAll('.animate-fade-up');
      fadeUpElements.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(40px)';
        el.style.transition = `opacity 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.1}s, transform 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.1}s`;
      });

      // Fade in animations
      const fadeElements = document.querySelectorAll('.animate-fade');
      fadeElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 1s cubic-bezier(0.4,0,0.2,1)';
      });

      // Slide in left
      const slideLeftElements = document.querySelectorAll('.animate-slide-left');
      slideLeftElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-40px)';
        el.style.transition = 'opacity 0.8s cubic-bezier(0.4,0,0.2,1), transform 0.8s cubic-bezier(0.4,0,0.2,1)';
      });

      // Slide in right
      const slideRightElements = document.querySelectorAll('.animate-slide-right');
      slideRightElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(40px)';
        el.style.transition = 'opacity 0.8s cubic-bezier(0.4,0,0.2,1), transform 0.8s cubic-bezier(0.4,0,0.2,1)';
      });

      // Stagger children
      const staggerContainers = document.querySelectorAll('.animate-stagger');
      staggerContainers.forEach(container => {
        const children = container.children;
        Array.from(children).forEach((child, i) => {
          child.style.opacity = '0';
          child.style.transform = 'translateY(40px)';
          child.style.transition = `opacity 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.15}s, transform 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.15}s`;
        });
      });

      // Counter animations
      const counters = document.querySelectorAll('.animate-counter');
      console.log(`Found ${counters.length} counters`);
      counters.forEach(counter => {
        counter.style.opacity = '0';
        counter.style.transform = 'translateY(30px)';
        counter.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
      });

      if (typeof window.IntersectionObserver === 'undefined') {
        console.log('IntersectionObserver not supported, using fallback');
        document.querySelectorAll('.animate-fade-up, .animate-fade, .animate-slide-left, .animate-slide-right, .animate-counter').forEach(el => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          if (el.classList.contains('animate-counter')) {
            this.animateCounter(el);
          }
        });
        return;
      }

      console.log('Creating IntersectionObserver');
      // Create observer with proper context binding
      const self = this;
      const observer = new IntersectionObserver((entries) => {
        console.log(`Observer triggered with ${entries.length} entries`);
        entries.forEach(entry => {
          console.log(`Entry: isIntersecting=${entry.isIntersecting}, classList=${entry.target.className.substring(0, 50)}`);
          if (entry.isIntersecting) {
            if (entry.target.classList.contains('animate-fade-up')) {
              entry.target.style.opacity = '1';
              entry.target.style.transform = 'translateY(0)';
            }
            if (entry.target.classList.contains('animate-fade')) {
              entry.target.style.opacity = '1';
            }
            if (entry.target.classList.contains('animate-slide-left')) {
              entry.target.style.opacity = '1';
              entry.target.style.transform = 'translateX(0)';
            }
            if (entry.target.classList.contains('animate-slide-right')) {
              entry.target.style.opacity = '1';
              entry.target.style.transform = 'translateX(0)';
            }
            if (entry.target.classList.contains('animate-counter')) {
              console.log('Animating counter');
              entry.target.style.opacity = '1';
              entry.target.style.transform = 'translateY(0)';
              self.animateCounter(entry.target);
            }

            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' });

      // Observe stagger containers
      staggerContainers.forEach(container => {
        const children = container.children;
        Array.from(children).forEach(child => observer.observe(child));
      });

      // Observe all animated elements
      document.querySelectorAll('.animate-fade-up, .animate-fade, .animate-slide-left, .animate-slide-right, .animate-counter').forEach(el => {
        observer.observe(el);
      });
    } catch (error) {
      console.warn('ScrollAnimations initialization failed:', error);
      document.querySelectorAll('.animate-fade-up, .animate-fade, .animate-slide-left, .animate-slide-right, .animate-counter').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        if (el.classList.contains('animate-counter')) {
          this.animateCounter(el);
        }
      });
    }
  },

  animateCounter(el) {
    const target = parseFloat(el.dataset.target) || 0;
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const duration = 2000;
    const start = performance.now();
    const isFloat = target % 1 !== 0;

    const update = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;

      if (isFloat) {
        el.textContent = prefix + current.toFixed(2) + suffix;
      } else {
        el.textContent = prefix + Math.floor(current) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    requestAnimationFrame(update);
  }
};

// ========================================
// FAQ Accordion
// ========================================
const FAQ = {
  init() {
    const items = document.querySelectorAll('.faq-item');
    items.forEach(item => {
      const question = item.querySelector('.faq-question');
      if (question) {
        question.addEventListener('click', () => {
          const isActive = item.classList.contains('active');
          // Close all
          items.forEach(i => i.classList.remove('active'));
          // Open clicked if wasn't active
          if (!isActive) {
            item.classList.add('active');
          }
        });
      }
    });
  }
};

// ========================================
// Testimonials Carousel
// ========================================
const Testimonials = {
  init() {
    const scrollContainer = document.querySelector('.testimonials-scroll');
    const dots = document.querySelectorAll('.testimonial-dots .dot');
    if (!scrollContainer || !dots.length) return;

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        const cardWidth = 360 + 24; // card width + gap
        scrollContainer.scrollTo({
          left: i * cardWidth,
          behavior: 'smooth'
        });
      });
    });

    scrollContainer.addEventListener('scroll', () => {
      const cardWidth = 360 + 24;
      const index = Math.round(scrollContainer.scrollLeft / cardWidth);
      dots.forEach((d, i) => {
        d.classList.toggle('active', i === index);
      });
    });
  }
};

// ========================================
// Mobile Menu
// ========================================
const MobileMenu = {
  init() {
    const btn = document.querySelector('.mobile-menu-btn');
    const nav = document.querySelector('.mobile-nav');
    if (!btn || !nav) return;

    btn.type = 'button';
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      nav.classList.toggle('active');
    });

    // Close on link click
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        btn.classList.remove('active');
        nav.classList.remove('active');
      });
    });
  }
};

// ========================================
// Navbar Scroll Effect
// ========================================
const NavbarScroll = {
  init() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });
  }
};

// ========================================
// Login Form Handler
// ========================================
const LoginForm = {
  init() {
    const form = document.getElementById('login-form');
    if (!form) return;

    // Role toggle
    const roleOptions = document.querySelectorAll('.role-option');
    let selectedRole = 'user';

    roleOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        roleOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedRole = opt.dataset.role;
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      if (!email || !password) {
        alert('Please fill in all fields');
        return;
      }

      const user = Auth.login(email, password, selectedRole);

      // Redirect based on role
      if (user.role === 'admin') {
        window.location.href = 'admin-dashboard.html';
      } else {
        window.location.href = 'user-dashboard.html';
      }
    });
  }
};

// ========================================
// Register Form Handler
// ========================================
const RegisterForm = {
  init() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const confirm = document.getElementById('reg-confirm').value;

      if (!name || !email || !password || !confirm) {
        alert('Please fill in all fields');
        return;
      }

      if (password !== confirm) {
        alert('Passwords do not match');
        return;
      }

      if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
      }

      Auth.register(name, email, password, 'user');
      window.location.href = 'user-dashboard.html';
    });
  }
};

// ========================================
// Smooth Scroll (Lenis-like)
// ========================================
const SmoothScroll = {
  init() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }
};

// ========================================
// Initialize Everything
// ========================================
document.addEventListener('DOMContentLoaded', () => {
  // Init auth
  Auth.init();

  // Init 3D network (only if canvas container exists)
  if (document.getElementById('canvas-container')) {
    // Check for Three.js availability
    if (typeof THREE !== 'undefined') {
      Network3D.init();
    }
  }

  // Init UI components
  try {
    //ScrollAnimations.init();
  } catch (error) {
    console.warn('Scroll animations failed to initialize:', error);
  }
  FAQ.init();
  Testimonials.init();
  MobileMenu.init();
  NavbarScroll.init();
  LoginForm.init();
  RegisterForm.init();
  SmoothScroll.init();

  // Dashboard-specific init
  if (document.querySelector('.dashboard-layout')) {
    initDashboard();
  }
});

// Dashboard functions
function initDashboard() {
  // Populate user info
  const user = Auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // Update user display
  const userNameEls = document.querySelectorAll('.dashboard-user-name');
  userNameEls.forEach(el => el.textContent = user.name);

  const userRoleEls = document.querySelectorAll('.dashboard-user-role');
  userRoleEls.forEach(el => el.textContent = user.role === 'admin' ? 'Administrator' : 'User');

  const userInitialEls = document.querySelectorAll('.dashboard-user-initial');
  userInitialEls.forEach(el => el.textContent = user.name.charAt(0).toUpperCase());

  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => Auth.logout());
  }

  // Mobile sidebar toggle
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
  }

  // Animate dashboard cards
  const dashboardCards = document.querySelectorAll('.dashboard-card');
  dashboardCards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, i * 100);
  });
}

// Make Auth globally available
window.Auth = Auth;
window.Network3D = Network3D;
