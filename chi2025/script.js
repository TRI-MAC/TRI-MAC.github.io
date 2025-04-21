document.addEventListener('DOMContentLoaded', () => {
    const dots = document.querySelectorAll('.dots .dot');
    const slides = document.querySelectorAll('.carousel-item');
    const prevButton = document.querySelector('.nav-button.prev');
    const nextButton = document.querySelector('.nav-button.next');
    let currentSlide = 0;
    let isAnimating = false;

    // Add click handler to remove focus from all buttons
    document.querySelectorAll('button, .button').forEach(button => {
        button.addEventListener('click', () => {
            button.blur();
        });
    });

    // Add scroll functionality for Join Us button
    const joinUsButton = document.querySelector('.button-wrapper .button');
    const joinUsSection = document.querySelector('.joinus-section');
    const learnMoreButton = document.querySelector('.buttons .button:last-child');
    const carouselSection = document.querySelector('.carousel-section');

    joinUsButton.addEventListener('click', () => {
        joinUsSection.scrollIntoView({ 
            behavior: 'smooth',
            block: 'start'
        });
    });

    learnMoreButton.addEventListener('click', () => {
        carouselSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });

    function updateCarousel(newSlide) {
        if (isAnimating || newSlide === currentSlide) return;
        isAnimating = true;

        // Remove active class from all dots and slides
        dots.forEach(dot => dot.classList.remove('active'));
        slides.forEach(slide => slide.classList.remove('active'));

        // Add active class to current dot and slide
        dots[newSlide].classList.add('active');
        slides[newSlide].classList.add('active');

        currentSlide = newSlide;

        // Reset animation lock after transition
        setTimeout(() => {
            isAnimating = false;
        }, 500);
    }

    // Initialize first slide
    updateCarousel(0);

    function goToNextSlide() {
        const nextSlide = (currentSlide + 1) % slides.length;
        updateCarousel(nextSlide);
    }

    function goToPrevSlide() {
        const prevSlide = (currentSlide - 1 + slides.length) % slides.length;
        updateCarousel(prevSlide);
    }

    // Add click handlers to navigation buttons
    nextButton.addEventListener('click', goToNextSlide);
    prevButton.addEventListener('click', goToPrevSlide);

    // Add click handlers to dots
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            updateCarousel(index);
        });
    });

    // Add touch support
    let touchStartX = 0;
    let touchEndX = 0;
    const carousel = document.querySelector('.carousel-container');

    carousel.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);

    carousel.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);

    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                goToNextSlide();
            } else {
                goToPrevSlide();
            }
        }
    }

    // Add keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            goToPrevSlide();
        } else if (e.key === 'ArrowRight') {
            goToNextSlide();
        }
    });
}); 