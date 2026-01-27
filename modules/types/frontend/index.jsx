import React from 'react';

function TypesModuleMain() {
  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="p-4 border-b bg-white font-semibold">Types</div>
      <div className="p-4 text-sm text-gray-700">Shared type helpers for the app. No interactive UI.</div>
    </div>
  );
}

export default TypesModuleMain;
export { TypesModuleMain as Main };

