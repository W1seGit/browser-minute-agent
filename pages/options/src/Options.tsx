import { useState } from 'react';
import type { ComponentType } from 'react';
import '@src/Options.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiShield } from 'react-icons/fi';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';

type TabTypes = 'general' | 'models' | 'firewall';

const TABS: { id: TabTypes; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
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
        return <ModelSettings />;
      case 'firewall':
        return <FirewallSettings isDarkMode={true} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-black/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Browser agent</p>
              <h1 className="mt-1 text-xl font-semibold text-white">min-agent</h1>
            </div>
            <nav className="flex gap-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-1">
              {TABS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTabClick(item.id)}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-medium transition ${
                    activeTab === item.id
                      ? 'bg-white text-slate-950'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                  }`}>
                  <item.icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="min-w-0 bg-black px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1600px]">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
