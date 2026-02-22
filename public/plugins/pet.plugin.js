export default {
  meta: {
    id: 'com.walkingfish.pet',
    name: '桌面寵物',
    version: '1.7',
    description: '一隻可愛的貓咪陪伴你記帳！(可拖曳移動、點擊互動)',
    author: 'The walking fish 步行魚',
    icon: 'fa-cat',
  },
  init(context) {
    // Load position or default
    const savedPos = context.storage.getJSON('pos')

    // Create Pet Element
    const pet = document.createElement('div')
    pet.id = 'screen-pet'

    // --- SVG Design (Kawaii Style) ---
    pet.innerHTML = `
            <svg viewBox="0 0 120 120" width="80" height="80" style="overflow: visible;">
                <defs>
                    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000" flood-opacity="0.15"/>
                    </filter>
                </defs>
                <g class="cat-wrapper">
                    <!-- Tail -->
                    <g class="cat-tail">
                        <path d="M 85 85 Q 115 85 110 50 Q 105 30 95 35 Q 85 40 85 70" fill="#ffb461" />
                        <path d="M 85 85 Q 115 85 110 50 Q 105 30 95 35 Q 85 40 85 70" stroke="#f19022" stroke-width="2" fill="none" />
                        <!-- Stripes on tail -->
                        <path d="M 103 45 Q 106 48 108 45" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                        <path d="M 98 60 Q 101 63 103 60" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                    </g>
                    
                    <!-- Back Legs -->
                    <g class="cat-leg back-left">
                        <path d="M 25 80 Q 15 105 30 105 A 5 5 0 0 0 45 105 Q 40 80 45 80" fill="#ffb461" />
                        <line x1="30" y1="100" x2="30" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <line x1="36" y1="100" x2="36" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <path d="M 25 80 Q 15 95 30 100" stroke="#f19022" stroke-width="2" fill="none" />
                    </g>
                    
                    <g class="cat-leg back-right">
                        <path d="M 95 80 Q 105 105 90 105 A 5 5 0 0 1 75 105 Q 80 80 75 80" fill="#ffb461" />
                        <line x1="90" y1="100" x2="90" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <line x1="84" y1="100" x2="84" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <path d="M 95 80 Q 105 95 90 100" stroke="#f19022" stroke-width="2" fill="none" />
                    </g>

                    <!-- Body -->
                    <g class="cat-body">
                        <path d="M 35 55 Q 15 85 45 102 L 75 102 Q 105 85 85 55 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" />
                        <!-- Belly -->
                        <path d="M 45 65 Q 60 45 75 65 Q 80 95 60 98 Q 40 95 45 65 Z" fill="#fff5eb" stroke="#fff5eb" stroke-width="1" />
                        
                        <!-- Body stripes -->
                        <path d="M 27 65 Q 37 65 39 70" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                        <path d="M 23 80 Q 33 80 35 85" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                        <path d="M 93 65 Q 83 65 81 70" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                        <path d="M 97 80 Q 87 80 85 85" stroke="#f19022" stroke-width="3" stroke-linecap="round" fill="none" />
                    </g>

                    <!-- Front Legs -->
                    <g class="cat-leg front-left">
                        <path d="M 43 75 L 43 105 A 7 7 0 0 0 57 105 L 57 75 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" stroke-linejoin="round" />
                        <line x1="48" y1="100" x2="48" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <line x1="52" y1="100" x2="52" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                    </g>

                    <g class="cat-leg front-right">
                        <path d="M 63 75 L 63 105 A 7 7 0 0 0 77 105 L 77 75 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" stroke-linejoin="round" />
                        <line x1="68" y1="100" x2="68" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                        <line x1="72" y1="100" x2="72" y2="105" stroke="#f19022" stroke-width="2" stroke-linecap="round"/>
                    </g>

                    <!-- Collar -->
                    <g class="cat-collar">
                        <path d="M 38 58 Q 60 70 82 58" stroke="#ff4757" stroke-width="6" stroke-linecap="round" fill="none" />
                        <!-- Bell -->
                        <circle cx="60" cy="65" r="7" fill="#ffd32a" stroke="#d6a800" stroke-width="1" />
                        <line x1="55" y1="65" x2="65" y2="65" stroke="#d6a800" stroke-width="2" stroke-linecap="round" />
                        <circle cx="60" cy="67" r="1.5" fill="#d6a800" />
                        <line x1="60" y1="67" x2="60" y2="72" stroke="#d6a800" stroke-width="2" stroke-linecap="round" />
                    </g>

                    <!-- Head Group -->
                    <g class="cat-head">
                        <!-- Ears -->
                        <g class="cat-ear left">
                            <path d="M 23 38 Q 12 5 35 12 Q 45 25 48 35 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" stroke-linejoin="round" />
                            <path d="M 27 33 Q 22 17 34 19 Q 39 26 41 33 Z" fill="#ffb8b8" />
                        </g>
                        <g class="cat-ear right">
                            <path d="M 97 38 Q 108 5 85 12 Q 75 25 72 35 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" stroke-linejoin="round" />
                            <path d="M 93 33 Q 98 17 86 19 Q 81 26 79 33 Z" fill="#ffb8b8" />
                        </g>

                        <!-- Face Shape -->
                        <path d="M 16 48 Q 16 18 60 20 Q 104 18 104 48 Q 104 76 60 76 Q 16 76 16 48 Z" fill="#ffb461" stroke="#f19022" stroke-width="2" />
                        
                        <!-- Head Stripes -->
                        <path d="M 60 20 L 60 30" stroke="#f19022" stroke-width="3" stroke-linecap="round" />
                        <path d="M 52 23 L 52 30" stroke="#f19022" stroke-width="3" stroke-linecap="round" />
                        <path d="M 68 23 L 68 30" stroke="#f19022" stroke-width="3" stroke-linecap="round" />

                        <!-- Muzzle area -->
                        <ellipse cx="60" cy="54" rx="18" ry="12" fill="#fff5eb" />

                        <!-- Eyes -->
                        <g class="cat-eyes">
                            <circle cx="40" cy="46" r="7" fill="#2d3436" />
                            <circle cx="80" cy="46" r="7" fill="#2d3436" />
                            <!-- Catchlights -->
                            <circle cx="37" cy="43" r="2.5" fill="#ffffff" />
                            <circle cx="77" cy="43" r="2.5" fill="#ffffff" />
                            <circle cx="42" cy="48" r="1.2" fill="#ffffff" />
                            <circle cx="82" cy="48" r="1.2" fill="#ffffff" />
                        </g>

                        <!-- Nose & Mouth -->
                        <path d="M 57 51 L 63 51 L 60 54 Z" fill="#ff7675" />
                        <path d="M 55 56 Q 57.5 59 60 56 Q 62.5 59 65 56" fill="none" stroke="#2d3436" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>

                        <!-- Whiskers -->
                        <path d="M 28 50 Q 10 48 5 45" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
                        <path d="M 28 53 Q 10 53 5 53" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
                        <path d="M 28 56 Q 10 58 5 62" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
                        
                        <path d="M 92 50 Q 110 48 115 45" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
                        <path d="M 92 53 Q 110 53 115 53" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
                        <path d="M 92 56 Q 110 58 115 62" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />

                        <!-- Blush cheeks -->
                        <ellipse cx="32" cy="56" rx="7" ry="3.5" fill="#ff7675" opacity="0.4" />
                        <ellipse cx="88" cy="56" rx="7" ry="3.5" fill="#ff7675" opacity="0.4" />
                    </g>
                </g>
            </svg>
        `

    // Apply styles
    pet.style.cssText = `
            position: fixed;
            width: 80px;
            height: 80px;
            z-index: 10000;
            cursor: grab;
            filter: drop-shadow(0 4px 5px rgba(0,0,0,0.3));
            touch-action: none;
            user-select: none;
            /* Default position if nothing saved */
            left: ${savedPos ? savedPos.left : window.innerWidth - 100 + 'px'};
            top: ${savedPos ? savedPos.top : window.innerHeight - 100 + 'px'};
            transition: transform 0.2s, left 0.5s ease-in-out, top 0.5s ease-in-out; 
            /* Note: We use ease-in-out for walking. For dragging we override this */
        `

    // CSS Animations & States
    const style = document.createElement('style')
    style.textContent = `
            /* --- Animations --- */
            @keyframes floatUp {
                0% { opacity: 1; transform: translateY(0) scale(1) rotate(-10deg); }
                100% { opacity: 0; transform: translateY(-40px) scale(1.5) rotate(10deg); }
            }
            @keyframes tail-swish {
                0%, 100% { transform: rotate(0deg); }
                50% { transform: rotate(10deg); }
            }
            @keyframes blink {
                0%, 48%, 52%, 100% { transform: scaleY(1); }
                50% { transform: scaleY(0.1); }
            }
            @keyframes breathe {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(2px); }
            }
            @keyframes walk-bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-5px); }
            }
            @keyframes legs-dangle {
                0%, 100% { transform: rotate(-10deg); }
                50% { transform: rotate(10deg); }
            }
            @keyframes struggle {
                0%, 100% { transform: rotate(5deg); }
                50% { transform: rotate(-5deg); }
            }

            /* --- Element Targets --- */
            .cat-tail { transform-origin: 85px 85px; animation: tail-swish 3s ease-in-out infinite; }
            .cat-eyes { transform-origin: 60px 46px; animation: blink 4s infinite; }
            .cat-head { transform-origin: 60px 50px; animation: breathe 2s ease-in-out infinite; }

            /* --- States --- */
            
            /* Walking */
            .pet-walking .cat-wrapper {
                animation: walk-bounce 0.4s infinite;
            }
            
            /* Scruffed (Dragged) */
            .pet-scruffed {
                cursor: grabbing !important;
                transition: none !important; /* No smooth transition during drag */
                filter: drop-shadow(0 15px 10px rgba(0,0,0,0.2)) !important;
            }
            .pet-scruffed .cat-wrapper {
                transform-origin: 60px 20px; /* Pivot from neck/head */
                transform: rotate(15deg); /* Dangling angle */
                animation: struggle 1s ease-in-out infinite;
            }
            .pet-scruffed .cat-leg {
                transform-origin: 50% 0;
                animation: legs-dangle 0.3s ease-in-out infinite;
            }
            .pet-scruffed .cat-tail {
                animation: tail-swish 0.5s infinite; /* Nervous wag */
            }
            .pet-scruffed .cat-eyes {
                transform: scaleY(1.2) !important; /* Wide eyes */
                animation: none;
            }

            /* Direction Flip */
            .pet-flipped .cat-wrapper {
                transform: scaleX(-1);
            }
        `
    document.head.appendChild(style)
    document.body.appendChild(pet)

    // --- Logic ---

    let currentState = 'idle' // idle, walking, dragging
    let wanderTimer = null
    let isFlipped = false

    // --- Interaction: Dragging ---
    let dragOffsetX = 0
    let dragOffsetY = 0
    let isDraggingMotion = false
    let dragStartTime = 0

    const startDrag = e => {
      currentState = 'dragging'
      isDraggingMotion = false
      dragStartTime = Date.now()
      clearTimeout(wanderTimer) // Stop wandering

      pet.classList.add('pet-scruffed')
      pet.classList.remove('pet-walking')

      const clientX = e.type.includes('mouse')
        ? e.clientX
        : e.touches[0].clientX
      const clientY = e.type.includes('mouse')
        ? e.clientY
        : e.touches[0].clientY

      // Get precise offset from the top-left of the element
      const rect = pet.getBoundingClientRect()
      dragOffsetX = clientX - rect.left
      dragOffsetY = clientY - rect.top
    }

    const onDrag = e => {
      if (currentState !== 'dragging') return
      e.preventDefault() // Prevent scrolling while dragging
      isDraggingMotion = true

      const clientX = e.type.includes('mouse')
        ? e.clientX
        : e.touches[0].clientX
      const clientY = e.type.includes('mouse')
        ? e.clientY
        : e.touches[0].clientY

      // Raw position update (no strict boundary check during drag for smoothness)
      pet.style.left = `${clientX - dragOffsetX}px`
      pet.style.top = `${clientY - dragOffsetY}px`
    }

    const endDrag = e => {
      if (currentState !== 'dragging') return

      currentState = 'idle'
      pet.classList.remove('pet-scruffed')

      // Final Boundary Check and Save
      const rect = pet.getBoundingClientRect()
      let newX = rect.left
      let newY = rect.top

      // Keep fully on screen
      if (newX < 0) newX = 0
      if (newY < 0) newY = 0
      if (newX + rect.width > window.innerWidth)
        newX = window.innerWidth - rect.width
      if (newY + rect.height > window.innerHeight)
        newY = window.innerHeight - rect.height

      pet.style.left = `${newX}px`
      pet.style.top = `${newY}px`

      savePosition(newX, newY)

      if (!isDraggingMotion && Date.now() - dragStartTime < 400) {
        // Ignore native click later, trigger interaction now
        triggerInteraction()
      }

      // Resume wandering after a delay
      scheduleWander()
    }

    const savePosition = (x, y) => {
      context.storage.setJSON('pos', { left: `${x}px`, top: `${y}px` })
    }

    // --- Logic: Wandering ---
    const wander = () => {
      if (currentState === 'dragging') return

      // Decide: Walk or Stay? (60% stay, 40% walk)
      if (Math.random() > 0.4) {
        currentState = 'idle'
        pet.classList.remove('pet-walking')
        scheduleWander()
        return
      }

      // Pick a destination
      currentState = 'walking'
      pet.classList.add('pet-walking')

      const rect = pet.getBoundingClientRect()
      const currentX = rect.left
      const currentY = rect.top

      // Move within reason (max 200px away) but stay on screen
      const moveDist = 100 + Math.random() * 150
      const angle = Math.random() * Math.PI * 2

      let targetX = currentX + Math.cos(angle) * moveDist
      let targetY = currentY + Math.sin(angle) * moveDist

      // Clamp to screen
      targetX = Math.max(0, Math.min(window.innerWidth - 80, targetX))
      targetY = Math.max(0, Math.min(window.innerHeight - 80, targetY))

      // Face direction
      if (targetX < currentX) {
        pet.classList.add('pet-flipped')
        isFlipped = true
      } else {
        pet.classList.remove('pet-flipped')
        isFlipped = false
      }

      // Calculate duration based on distance (speed ~ 50px/s)
      const dist = Math.sqrt(
        Math.pow(targetX - currentX, 2) + Math.pow(targetY - currentY, 2)
      )
      const duration = dist / 50

      // Apply transition just for this move
      pet.style.transition = `left ${duration}s linear, top ${duration}s linear`
      pet.style.left = `${targetX}px`
      pet.style.top = `${targetY}px`

      // Wait for arrival
      wanderTimer = setTimeout(() => {
        if (currentState === 'dragging') return

        // Arrived
        currentState = 'idle'
        pet.classList.remove('pet-walking')

        // Reset transition for drag responsiveness
        pet.style.transition = 'transform 0.2s'

        savePosition(targetX, targetY)
        scheduleWander()
      }, duration * 1000)
    }

    const scheduleWander = () => {
      // Random delay between 5s and 15s
      const delay = 5000 + Math.random() * 10000
      wanderTimer = setTimeout(wander, delay)
    }

    // --- Events ---
    pet.addEventListener('mousedown', startDrag)
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)

    pet.addEventListener('touchstart', startDrag, { passive: false })
    document.addEventListener('touchmove', onDrag, { passive: false })
    document.addEventListener('touchend', endDrag)

    // Interaction Messages
    const messages = [
      '今天記帳了嗎？',
      '錢包還好嗎？',
      '喵～ 記得存錢喔！',
      '我在這裡陪你～',
      '加油！再堅持一下！',
      '要不要吃魚？🐟',
      '呼嚕呼嚕...💤',
      '蹭蹭你～ ❤️',
      '打起精神來喵！✨',
      '理財就是理生活喵！',
    ]

    const triggerInteraction = () => {
      const msg = messages[Math.floor(Math.random() * messages.length)]
      context.ui.showToast(msg, 'info')

      // Force animation reset
      pet.style.transition = 'none'
      pet.style.transform = isFlipped ? 'scaleX(-1)' : 'none'

      // Add a lovely visual effect
      const heart = document.createElement('div')
      heart.textContent = '❤️'
      heart.style.cssText = `
                position: absolute;
                left: 30px;
                top: -10px;
                font-size: 24px;
                pointer-events: none;
                animation: floatUp 1s ease-out forwards;
                z-index: 10001;
                filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
            `
      pet.appendChild(heart)
      setTimeout(() => heart.remove(), 1000)

      // Trigger jump
      requestAnimationFrame(() => {
        pet.style.transition =
          'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        pet.style.transform = isFlipped
          ? 'scaleX(-1) translateY(-20px)'
          : 'translateY(-20px)'
      })

      setTimeout(() => {
        pet.style.transform = isFlipped ? 'scaleX(-1)' : 'none'
      }, 300)
    }

    // Prevent double trigger from native click
    pet.addEventListener('click', e => {
      e.preventDefault()
    })

    // Initialize Loop
    scheduleWander()
    console.log('Smart Pet initialized')
  },
}
