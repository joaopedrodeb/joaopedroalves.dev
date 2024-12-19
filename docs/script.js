// JavaScript for simple interactivity

document.addEventListener("DOMContentLoaded", () => {
    console.log("Portfolio site loaded successfully.");
    
    // Add any interactivity if required, such as smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
});
