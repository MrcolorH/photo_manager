import { createContext, useContext, useState, useCallback } from 'react';

const RepoContext = createContext();

export function RepoProvider({ children }) {
  const [currentRepoId, setCurrentRepoId] = useState(null);
  // 仓库数据版本号：每次仓库内数据发生变化（导入/删除/重建清单等）时递增，
  // 供 Layout 的存储统计等组件监听以触发刷新
  const [storageVersion, setStorageVersion] = useState(0);

  // 触发存储统计刷新：递增版本号，监听者会重新拉取数据
  const bumpStorageVersion = useCallback(() => {
    setStorageVersion((v) => v + 1);
  }, []);

  return (
    <RepoContext.Provider
      value={{ currentRepoId, setCurrentRepoId, storageVersion, bumpStorageVersion }}
    >
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  return useContext(RepoContext);
}
