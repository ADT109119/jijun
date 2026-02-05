export default {
    meta: {
        id: 'com.walkingfish.pet',
        name: '桌面寵物',
        version: '1.3',
        description: '一隻可愛的貓咪陪伴你記帳！(可拖曳移動、點擊互動)',
        author: 'The walking fish 步行魚',
        icon: 'fa-cat'
    },
    init(context) {
        // Load position
        const savedPos = JSON.parse(localStorage.getItem('pet_plugin_pos') || '{"bottom": "80px", "right": "20px"}');

        // Create Pet Element
        const pet = document.createElement('div');
        pet.id = 'screen-pet';
        pet.textContent = '🐱';
        pet.style.cssText = `
            position: fixed;
            bottom: ${savedPos.bottom || '80px'};
            right: ${savedPos.right || '20px'};
            left: ${savedPos.left || 'auto'};
            top: ${savedPos.top || 'auto'};
            font-size: 40px;
            cursor: grab;
            z-index: 9999;
            user-select: none;
            touch-action: none;
            filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
            transition: transform 0.1s;
        `;

        // Add CSS animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pet-bounce {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.2); }
            }
            .pet-happy {
                animation: pet-bounce 0.5s !important;
            }
            .pet-dragging {
                cursor: grabbing !important;
                opacity: 0.8;
                transform: scale(1.1);
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(pet);

        // Interaction
        const messages = [
            '今天記帳了嗎？',
            '錢包還好嗎？',
            '記得存錢喔！',
            '喵～',
            '加油！'
        ];

        // Drag Logic
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let moveThreshold = 0; // Check if it's a click or drag

        const startDrag = (e) => {
            isDragging = true;
            moveThreshold = 0;
            pet.classList.add('pet-dragging');
            
            const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

            const rect = pet.getBoundingClientRect();
            // Use offsets relative to window
            startX = clientX;
            startY = clientY;
            initialLeft = rect.left;
            initialTop = rect.top;

            // Remove bottom/right positioning, switch to top/left for dragging
            pet.style.bottom = 'auto';
            pet.style.right = 'auto';
            pet.style.left = `${initialLeft}px`;
            pet.style.top = `${initialTop}px`;
        };

        const onDrag = (e) => {
            if (!isDragging) return;
            e.preventDefault();

            const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

            const dx = clientX - startX;
            const dy = clientY - startY;
            
            moveThreshold += Math.abs(dx) + Math.abs(dy);

            pet.style.left = `${initialLeft + dx}px`;
            pet.style.top = `${initialTop + dy}px`;
        };

        const endDrag = () => {
             if (!isDragging) return;
             isDragging = false;
             pet.classList.remove('pet-dragging');

             // Save position (as top/left or bottom/right?)
             // Let's save as top/left percentage or pixels to keep it simple
             const rect = pet.getBoundingClientRect();
             const pos = {
                 top: `${rect.top}px`,
                 left: `${rect.left}px`,
                 bottom: 'auto',
                 right: 'auto'
             };
             
             // Boundary check (keep within screen)
             if (rect.left < 0) pet.style.left = '0px';
             if (rect.top < 0) pet.style.top = '0px';
             if (rect.right > window.innerWidth) pet.style.left = `${window.innerWidth - rect.width}px`;
             if (rect.bottom > window.innerHeight) pet.style.top = `${window.innerHeight - rect.height}px`;

             // Update Saved Pos after boundary check
             const finalRect = pet.getBoundingClientRect();
             const finalPos = {
                 top: `${finalRect.top}px`,
                 left: `${finalRect.left}px`,
                 bottom: 'auto',
                 right: 'auto'
             };

             localStorage.setItem('pet_plugin_pos', JSON.stringify(finalPos));

             // Handle Click if move was minimal
             if (moveThreshold < 5) {
                 handleClick();
             }
        };

        const handleClick = () => {
            pet.classList.add('pet-happy');
            setTimeout(() => pet.classList.remove('pet-happy'), 500);
            const msg = messages[Math.floor(Math.random() * messages.length)];
            context.ui.showToast(msg, 'info');
        };

        pet.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);

        pet.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', endDrag);


        // Page Hooks (Reactions)
        context.events.on('onPageRenderAfter', (page) => {
            // Animation for page change?
            pet.style.animation = 'pet-bounce 0.3s';
            setTimeout(() => pet.style.animation = '', 300);

            if (page === 'add') {
                pet.textContent = '👀'; 
            } else if (page === 'stats') {
                pet.textContent = '📊';
            } else {
                pet.textContent = '🐱';
            }
        });

        console.log('Screen Pet initialized (Draggable)');
    }
};
