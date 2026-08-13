const { h, Component, render } = preact;
const { useState, useEffect } = preactHooks;
const { signal } = preactSignals;
const html = htm.bind(h);

window.html = html;

// Global State
const currentView = signal('Home');
const isSidebarOpen = signal(false);

const Sidebar = () => {
  const navItems = ['Home', 'Search', 'Write', 'Notifications', 'Profile'];

  const handleNav = (item) => {
    currentView.value = item;
    isSidebarOpen.value = false; // Close sidebar on mobile
  };

  return html`
    <aside class="sidebar ${isSidebarOpen.value ? 'open' : ''}">
      <div class="sidebar-header">
        <h2>App Menu</h2>
        <button class="close-btn mobile-only" onClick=${() => isSidebarOpen.value = false}>×</button>
      </div>
      <nav class="sidebar-nav">
        <ul>
          ${navItems.map(item => html`
            <li class="${currentView.value === item ? 'active' : ''}" onClick=${() => handleNav(item)}>
              ${item}
            </li>
          `)}
        </ul>
      </nav>
    </aside>
  `;
};

const Header = () => {
  return html`
    <header class="app-header">
      <button class="menu-btn mobile-only" onClick=${() => isSidebarOpen.value = true}>
        ☰
      </button>
      <h1>${currentView.value}</h1>
    </header>
  `;
};

const Content = () => {
    const renderView = () => {
        switch (currentView.value) {
            case 'Home':
                return html`<div class="view home-view">
                    <h2>Welcome to the App</h2>
                    <p>This is a standalone PWA built without a build process.</p>
                </div>`;
            case 'Search':
                return html`<div class="view search-view">
                    <input type="search" placeholder="Search..." class="search-input" />
                    <div class="search-results">
                        <p>Search results will appear here...</p>
                    </div>
                </div>`;
            case 'Write':
                return html`<div class="view write-view">
                    <textarea placeholder="What's on your mind?..." class="write-input"></textarea>
                    <button class="primary-btn">Publish</button>
                </div>`;
            case 'Notifications':
                return html`<div class="view notifications-view">
                    <ul>
                        <li><div class="notif">New follower: Antonio Gallo</div></li>
                        <li><div class="notif">Your story was clapped 50 times</div></li>
                    </ul>
                </div>`;
            case 'Profile':
                return html`<div class="view profile-view">
                    <div class="profile-header">
                        <div class="avatar">U</div>
                        <div>
                            <h2>User Name</h2>
                            <p>Software Developer | Writer</p>
                        </div>
                    </div>
                </div>`;
            default:
                return html`<div>View not found</div>`;
        }
    };

    return html`
        <main class="app-content">
            ${renderView()}
        </main>
    `;
};

const App = () => {
  return html`
    <div class="app-container">
      <${Sidebar} />
      <div class="main-wrapper ${isSidebarOpen.value ? 'dimmed' : ''}">
        <${Header} />
        <${Content} />
      </div>
    </div>
  `;
};

render(html`<${App} />`, document.getElementById('app'));
