document.addEventListener('DOMContentLoaded', () => {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transition = 'opacity 0.5s';
            setTimeout(() => alert.remove(), 500);
        }, 5000);
    });

    // Confirm destructive actions (already handled inline via onsubmit, but backup here)
    document.querySelectorAll('form[onsubmit]').forEach(form => {
        form.addEventListener('submit', (e) => {
            const confirmed = confirm(form.getAttribute('onsubmit').replace('return confirm(', '').replace(');', '').replace(/['"]/g, ''));
            if (!confirmed) e.preventDefault();
        });
    });
});