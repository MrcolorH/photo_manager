import { createContext, useContext, useState } from 'react';

const RepoContext = createContext();

export function RepoProvider({ children }) {
  const [currentRepoId, setCurrentRepoId] = useState(null);
  return (
    <RepoContext.Provider value={{ currentRepoId, setCurrentRepoId }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  return useContext(RepoContext);
}
