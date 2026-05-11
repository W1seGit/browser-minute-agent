import { useState } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiShield } from 'react-icons/fi';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';

type TabTypes = 'general' | 'models' | 'firewall';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'models', icon: FiCpu, label: 'Providers' },
  { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>('models');

  const handleTabClick = (tabId: TabTypes) => {
    setActiveTab(tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings isDarkMode={true} />;
      case 'models':
        return <ModelSettings isDarkMode={true} />;
      case 'firewall':
        return <FirewallSettings isDarkMode={true} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen min-w-[768px] bg-black text-white">
      {/* Vertical Navigation Bar */}
      <nav className="w-52 border-r border-white/10 bg-black">
        <div className="p-4">
          <h1 className="mb-6 text-xl font-semibold text-white">min-agent</h1>
          <ul className="space-y-2">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors
                    ${
                      activeTab !== item.id
                        ? 'bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white'
                        : 'bg-white text-black'
                    }`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 bg-black p-8">
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
