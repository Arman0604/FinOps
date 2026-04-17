import React from 'react';
import { Search, Bell } from 'lucide-react';
import styles from './Header.module.css';

const Header: React.FC = () => {
  return (
    <header className={styles.header}>
      {/* Search */}
      <div className={styles.searchBar}>
        <Search className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search services, teams, anomalies…"
          className={styles.searchInput}
        />
        <span className={styles.kbdHint}>
          <kbd>⌘K</kbd>
        </span>
      </div>

      {/* Right Controls */}
      <div className={styles.rightSection}>
        {/* Live indicator */}
        <div className={styles.liveBadge}>
          <div className={styles.livePulse} />
          Live
        </div>

        {/* Notifications */}
        <button className={styles.iconBtn} title="Notifications">
          <Bell size={15} />
          <span className={styles.notificationBadge}>3</span>
        </button>

        {/* Avatar */}
        <div className={styles.avatarBtn}>
          <div className={styles.avatar}>
            <img
              src="https://ui-avatars.com/api/?name=FinOps+User&background=0891B2&color=fff&bold=true"
              alt="User"
            />
          </div>
          <span className={styles.avatarName}>Admin</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
