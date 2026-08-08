export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span>© {new Date().getFullYear()} Ладдер страждання · фан-проєкт спільноти</span>
        <span className="muted">Perfect World та пов'язані назви належать їхнім власникам.</span>
      </div>
    </footer>
  );
}
