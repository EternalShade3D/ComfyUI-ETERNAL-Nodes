/* ComfyUI-ETERNAL-Nodes page — mobile menu, accordions, zoom gallery */
function toggleMenu(){
            var btn = document.querySelector('.menu-btn');
            var menu = document.getElementById('mobile-menu');
            var open = menu.classList.contains('open');
            if(open){
                menu.classList.remove('open');
                btn.setAttribute('aria-expanded','false');
            } else {
                menu.classList.add('open');
                btn.setAttribute('aria-expanded','true');
            }
        }
        document.querySelectorAll('#mobile-menu a').forEach(function(a){
            a.addEventListener('click', function(){
                document.getElementById('mobile-menu').classList.remove('open');
                document.querySelector('.menu-btn').setAttribute('aria-expanded','false');
            });
        });
        document.querySelectorAll('.doc-item').forEach(function(details){
            details.addEventListener('toggle', function(){
                if(details.open){
                    document.querySelectorAll('.doc-item').forEach(function(other){
                        if(other !== details) other.removeAttribute('open');
                    });
                }
            });
        });

        // Zoom modal gallery
        (function(){
            var modal = document.getElementById('zoom-modal');
            var zoomImg = document.getElementById('zoom-img');
            var zoomCaption = document.getElementById('zoom-caption');
            var cards = document.querySelectorAll('[data-zoom]');
            var list = [];
            var idx = 0;

            cards.forEach(function(c){
                list.push({
                    src: c.getAttribute('data-zoom'),
                    alt: c.getAttribute('data-zoom-alt')
                });
            });

            function open(n){
                idx = ((n % list.length) + list.length) % list.length;
                var item = list[idx];
                zoomImg.src = item.src;
                zoomCaption.textContent = item.alt;
                modal.classList.add('open');
                modal.setAttribute('aria-hidden','false');
                document.body.style.overflow = 'hidden';
            }
            function close(){
                modal.classList.remove('open');
                modal.setAttribute('aria-hidden','true');
                document.body.style.overflow = '';
            }
            cards.forEach(function(c, i){
                c.addEventListener('click', function(){ open(i); });
                c.addEventListener('keydown', function(e){
                    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(i); }
                });
            });
            document.getElementById('zoom-close').addEventListener('click', close);
            document.getElementById('zoom-backdrop').addEventListener('click', close);
            document.getElementById('zoom-prev').addEventListener('click', function(e){ e.stopPropagation(); open(idx - 1); });
            document.getElementById('zoom-next').addEventListener('click', function(e){ e.stopPropagation(); open(idx + 1); });
            document.addEventListener('keydown', function(e){
                if(modal.getAttribute('aria-hidden') === 'false'){
                    if(e.key === 'Escape') close();
                    else if(e.key === 'ArrowLeft') open(idx - 1);
                    else if(e.key === 'ArrowRight') open(idx + 1);
                }
            });
        })();
