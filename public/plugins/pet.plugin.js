export default {
    meta: {
        id: 'com.walkingfish.pet',
        name: '桌面寵物',
        version: '1.4',
        description: '一隻可愛的貓咪陪伴你記帳！(可拖曳移動、點擊互動)',
        author: 'The walking fish 步行魚',
        icon: 'fa-cat'
    },
    init(context) {
        // Load position or default
        const savedPos = JSON.parse(localStorage.getItem('pet_plugin_pos') || 'null');
        
        // Create Pet Element
        const pet = document.createElement('div');
        pet.id = 'screen-pet';
        
        // --- SVG Design (Kawaii Style) ---
        pet.innerHTML = `
            <svg viewBox="0 0 120 120" width="80" height="80" style="overflow: visible;">
                <defs>
                    <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1.5" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                    </filter>
                </defs>
                <g class="cat-wrapper">
                    <!-- Tail -->
                    <path class="cat-tail" d="M90 90 Q 110 80, 100 50" stroke="#FF9A00" stroke-width="8" fill="none" stroke-linecap="round" />
                    
                    <!-- Legs (Back) -->
                    <path class="cat-leg back-left" d="M35 90 L 35 105" stroke="#FF9A00" stroke-width="7" stroke-linecap="round" />
                    <path class="cat-leg back-right" d="M85 90 L 85 105" stroke="#FF9A00" stroke-width="7" stroke-linecap="round" />

                    <!-- Body (Rounded Rectangle) -->
                    <rect class="cat-body" x="25" y="60" width="70" height="45" rx="20" ry="20" fill="#FFB347" />
                    <ellipse class="cat-belly" cx="60" cy="85" rx="20" ry="12" fill="#FFE5B4" />

                    <!-- Legs (Front) -->
                    <path class="cat-leg front-left" d="M40 90 L 40 105" stroke="#FF9A00" stroke-width="7" stroke-linecap="round" />
                    <path class="cat-leg front-right" d="M80 90 L 80 105" stroke="#FF9A00" stroke-width="7" stroke-linecap="round" />

                    <!-- Head Group -->
                    <g class="cat-head">
                        <!-- Ears -->
                        <path d="M25 45 L 20 20 L 45 35" fill="#FFB347" stroke="#E68A00" stroke-width="2" stroke-linejoin="round"/> <!-- Left -->
                        <path d="M95 45 L 100 20 L 75 35" fill="#FFB347" stroke="#E68A00" stroke-width="2" stroke-linejoin="round"/> <!-- Right -->
                        
                        <!-- Inner Ears -->
                        <path d="M28 42 L 25 28 L 40 36" fill="#FFE5B4" />
                        <path d="M92 42 L 95 28 L 80 36" fill="#FFE5B4" />

                        <!-- Face Shape -->
                        <ellipse cx="60" cy="50" rx="40" ry="32" fill="#FFB347" stroke="#E68A00" stroke-width="2" />
                        
                        <!-- Eyes -->
                        <g class="cat-eyes">
                            <circle cx="45" cy="45" r="5" fill="#333" />
                            <circle cx="75" cy="45" r="5" fill="#333" />
                            <circle cx="47" cy="43" r="2" fill="white" />
                            <circle cx="77" cy="43" r="2" fill="white" />
                        </g>

                        <!-- Snout -->
                        <ellipse cx="60" cy="55" rx="6" ry="4" fill="#FFE5B4" />
                        <path d="M58 56 L 60 58 L 62 56" fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        
                        <!-- Cheeks -->
                        <circle cx="35" cy="55" r="3" fill="#FFA07A" opacity="0.6" />
                        <circle cx="85" cy="55" r="3" fill="#FFA07A" opacity="0.6" />
                    </g>
                </g>
            </svg>
        `;

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
            left: ${savedPos ? savedPos.left : (window.innerWidth - 100) + 'px'};
            top: ${savedPos ? savedPos.top : (window.innerHeight - 100) + 'px'};
            transition: transform 0.2s, left 0.5s ease-in-out, top 0.5s ease-in-out; 
            /* Note: We use ease-in-out for walking. For dragging we override this */
        `;

        // CSS Animations & States
        const style = document.createElement('style');
        style.textContent = `
            /* --- Animations --- */
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
            .cat-tail { transform-origin: 90px 90px; animation: tail-swish 3s ease-in-out infinite; }
            .cat-eyes { transform-origin: 60px 45px; animation: blink 4s infinite; }
            .cat-head { animation: breathe 2s ease-in-out infinite; }

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
        `;
        document.head.appendChild(style);
        document.body.appendChild(pet);

        // --- Logic ---
        
        let currentState = 'idle'; // idle, walking, dragging
        let wanderTimer = null;
        let isFlipped = false;

        // --- Interaction: Dragging ---
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        const startDrag = (e) => {
            e.preventDefault();
            currentState = 'dragging';
            clearTimeout(wanderTimer); // Stop wandering
            
            pet.classList.add('pet-scruffed');
            pet.classList.remove('pet-walking');

            const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
            
            // Get precise offset from the top-left of the element
            const rect = pet.getBoundingClientRect();
            dragOffsetX = clientX - rect.left;
            dragOffsetY = clientY - rect.top;
        };

        const onDrag = (e) => {
            if (currentState !== 'dragging') return;
            e.preventDefault();

            const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

            // Raw position update (no strict boundary check during drag for smoothness)
            pet.style.left = `${clientX - dragOffsetX}px`;
            pet.style.top = `${clientY - dragOffsetY}px`;
        };

        const endDrag = (e) => {
            if (currentState !== 'dragging') return;
            
            currentState = 'idle';
            pet.classList.remove('pet-scruffed');

            // Final Boundary Check and Save
            const rect = pet.getBoundingClientRect();
            let newX = rect.left;
            let newY = rect.top;

            // Keep fully on screen
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            if (newX + rect.width > window.innerWidth) newX = window.innerWidth - rect.width;
            if (newY + rect.height > window.innerHeight) newY = window.innerHeight - rect.height;

            pet.style.left = `${newX}px`;
            pet.style.top = `${newY}px`;

            savePosition(newX, newY);
            
            // Resume wandering after a delay
            scheduleWander();
        };

        const savePosition = (x, y) => {
            localStorage.setItem('pet_plugin_pos', JSON.stringify({ left: `${x}px`, top: `${y}px` }));
        };

        // --- Logic: Wandering ---
        const wander = () => {
            if (currentState === 'dragging') return;

            // Decide: Walk or Stay? (60% stay, 40% walk)
            if (Math.random() > 0.4) {
                currentState = 'idle';
                pet.classList.remove('pet-walking');
                scheduleWander();
                return;
            }

            // Pick a destination
            currentState = 'walking';
            pet.classList.add('pet-walking');

            const rect = pet.getBoundingClientRect();
            const currentX = rect.left;
            const currentY = rect.top;

            // Move within reason (max 200px away) but stay on screen
            const moveDist = 100 + Math.random() * 150;
            const angle = Math.random() * Math.PI * 2;
            
            let targetX = currentX + Math.cos(angle) * moveDist;
            let targetY = currentY + Math.sin(angle) * moveDist;

            // Clamp to screen
            targetX = Math.max(0, Math.min(window.innerWidth - 80, targetX));
            targetY = Math.max(0, Math.min(window.innerHeight - 80, targetY));

            // Face direction
            if (targetX < currentX) {
                pet.classList.add('pet-flipped');
                isFlipped = true;
            } else {
                pet.classList.remove('pet-flipped');
                isFlipped = false;
            }

            // Calculate duration based on distance (speed ~ 50px/s)
            const dist = Math.sqrt(Math.pow(targetX - currentX, 2) + Math.pow(targetY - currentY, 2));
            const duration = dist / 50; 

            // Apply transition just for this move
            pet.style.transition = `left ${duration}s linear, top ${duration}s linear`;
            pet.style.left = `${targetX}px`;
            pet.style.top = `${targetY}px`;

            // Wait for arrival
            wanderTimer = setTimeout(() => {
                if (currentState === 'dragging') return;
                
                // Arrived
                currentState = 'idle';
                pet.classList.remove('pet-walking');
                
                // Reset transition for drag responsiveness
                pet.style.transition = 'transform 0.2s';
                
                savePosition(targetX, targetY);
                scheduleWander();

            }, duration * 1000);
        };

        const scheduleWander = () => {
            // Random delay between 5s and 15s
            const delay = 5000 + Math.random() * 10000;
            wanderTimer = setTimeout(wander, delay);
        };

        // --- Events ---
        pet.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
        
        pet.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', endDrag);

        // Interaction Messages
        const messages = [
            '今天記帳了嗎？',
            '錢包還好嗎？',
            '喵～ 記得存錢喔！',
            '我在這裡陪你～',
            '加油！再堅持一下！',
            '要不要吃魚？🐟',
            '呼嚕呼嚕...💤',
            '蹭蹭你～ ❤️'
        ];

        // Click interaction (only if not dragged)
        pet.addEventListener('click', (e) => {
            if (currentState === 'dragging') return;
            
            const msg = messages[Math.floor(Math.random() * messages.length)];
            context.ui.showToast(msg, 'info');
            
            pet.style.transform = isFlipped ? 'scaleX(-1) translateY(-10px)' : 'translateY(-10px)';
            setTimeout(() => {
                pet.style.transform = isFlipped ? 'scaleX(-1)' : 'none';
            }, 300);
        });

        // Initialize Loop
        scheduleWander();
        console.log('Smart Pet initialized');
    }
};
