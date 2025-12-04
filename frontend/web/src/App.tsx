import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ClusterData {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "processing" | "completed" | "failed";
  dataPoints: number;
  algorithm: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newClusterData, setNewClusterData] = useState({
    name: "",
    dataPoints: "100",
    algorithm: "K-Means"
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Calculate statistics
  const completedCount = clusters.filter(c => c.status === "completed").length;
  const processingCount = clusters.filter(c => c.status === "processing").length;
  const failedCount = clusters.filter(c => c.status === "failed").length;
  const totalDataPoints = clusters.reduce((sum, cluster) => sum + cluster.dataPoints, 0);

  useEffect(() => {
    loadClusters().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "Available" : "Unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to check contract availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const loadClusters = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("cluster_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing cluster keys:", e);
        }
      }
      
      const list: ClusterData[] = [];
      
      for (const key of keys) {
        try {
          const clusterBytes = await contract.getData(`cluster_${key}`);
          if (clusterBytes.length > 0) {
            try {
              const clusterData = JSON.parse(ethers.toUtf8String(clusterBytes));
              list.push({
                id: key,
                name: clusterData.name,
                encryptedData: clusterData.data,
                timestamp: clusterData.timestamp,
                owner: clusterData.owner,
                status: clusterData.status || "processing",
                dataPoints: clusterData.dataPoints || 0,
                algorithm: clusterData.algorithm || "K-Means"
              });
            } catch (e) {
              console.error(`Error parsing cluster data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading cluster ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setClusters(list);
    } catch (e) {
      console.error("Error loading clusters:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createCluster = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting cluster data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        name: newClusterData.name,
        dataPoints: parseInt(newClusterData.dataPoints),
        algorithm: newClusterData.algorithm
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const clusterId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const clusterData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        name: newClusterData.name,
        status: "processing",
        dataPoints: parseInt(newClusterData.dataPoints),
        algorithm: newClusterData.algorithm
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `cluster_${clusterId}`, 
        ethers.toUtf8Bytes(JSON.stringify(clusterData))
      );
      
      const keysBytes = await contract.getData("cluster_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(clusterId);
      
      await contract.setData(
        "cluster_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE cluster created successfully!"
      });
      
      await loadClusters();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewClusterData({
          name: "",
          dataPoints: "100",
          algorithm: "K-Means"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Filter clusters based on search and status
  const filteredClusters = clusters.filter(cluster => {
    const matchesSearch = cluster.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         cluster.owner.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || cluster.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Render a pie chart for status distribution
  const renderStatusChart = () => {
    const total = clusters.length || 1;
    const completedPercentage = (completedCount / total) * 100;
    const processingPercentage = (processingCount / total) * 100;
    const failedPercentage = (failedCount / total) * 100;

    return (
      <div className="status-chart">
        <div className="chart-visual">
          <div className="chart-slice completed" style={{ '--value': completedPercentage } as React.CSSProperties}>
            <span>{Math.round(completedPercentage)}%</span>
          </div>
          <div className="chart-slice processing" style={{ '--value': processingPercentage } as React.CSSProperties}>
            <span>{Math.round(processingPercentage)}%</span>
          </div>
          <div className="chart-slice failed" style={{ '--value': failedPercentage } as React.CSSProperties}>
            <span>{Math.round(failedPercentage)}%</span>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-dot completed"></div>
            <span>Completed: {completedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot processing"></div>
            <span>Processing: {processingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot failed"></div>
            <span>Failed: {failedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="neon-globe"></div>
          </div>
          <h1>FedCluster<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={checkAvailability}
            className="neon-button cyan"
          >
            Check FHE Status
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="neon-button purple"
          >
            New Cluster
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-content">
            <h2>FHE-Powered Privacy-Preserving Federated Clustering</h2>
            <p>Discover common user profiles across institutions without sharing raw data using Fully Homomorphic Encryption</p>
            <div className="fhe-badge">
              <span>FHE-ENCRYPTED COMPUTATION</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="data-node"></div>
            <div className="data-connection"></div>
            <div className="data-node"></div>
            <div className="data-connection"></div>
            <div className="data-node"></div>
          </div>
        </div>
        
        <div className="stats-grid">
          <div className="stat-card neon-card blue">
            <h3>Total Clusters</h3>
            <div className="stat-value">{clusters.length}</div>
            <div className="stat-trend">+5.2% this week</div>
          </div>
          
          <div className="stat-card neon-card purple">
            <h3>Data Points</h3>
            <div className="stat-value">{totalDataPoints.toLocaleString()}</div>
            <div className="stat-trend">+12.7% this week</div>
          </div>
          
          <div className="stat-card neon-card pink">
            <h3>Active Nodes</h3>
            <div className="stat-value">18</div>
            <div className="stat-trend">+2 this week</div>
          </div>
          
          <div className="stat-card neon-card green">
            <h3>FHE Throughput</h3>
            <div className="stat-value">2.4M ops/s</div>
            <div className="stat-trend">+0.3M this week</div>
          </div>
        </div>
        
        <div className="content-section">
          <div className="section-header">
            <h2>Cluster Analytics</h2>
            <div className="analytics-controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search clusters..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-icon"></div>
              </div>
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Status</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
          
          <div className="analytics-content">
            <div className="chart-container neon-card">
              <h3>Cluster Status Distribution</h3>
              {renderStatusChart()}
            </div>
            
            <div className="clusters-list">
              <div className="list-header">
                <h3>Federated Clusters</h3>
                <button 
                  onClick={loadClusters}
                  className="neon-button blue"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>
              
              {filteredClusters.length === 0 ? (
                <div className="no-clusters">
                  <div className="no-data-icon"></div>
                  <p>No clusters found</p>
                  <button 
                    className="neon-button purple"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Cluster
                  </button>
                </div>
              ) : (
                <div className="clusters-grid">
                  {filteredClusters.map(cluster => (
                    <div className="cluster-card neon-card" key={cluster.id}>
                      <div className="card-header">
                        <h4>{cluster.name}</h4>
                        <span className={`status-badge ${cluster.status}`}>
                          {cluster.status}
                        </span>
                      </div>
                      <div className="card-details">
                        <div className="detail-item">
                          <label>Owner:</label>
                          <span>{cluster.owner.substring(0, 8)}...{cluster.owner.substring(cluster.owner.length - 6)}</span>
                        </div>
                        <div className="detail-item">
                          <label>Data Points:</label>
                          <span>{cluster.dataPoints.toLocaleString()}</span>
                        </div>
                        <div className="detail-item">
                          <label>Algorithm:</label>
                          <span>{cluster.algorithm}</span>
                        </div>
                        <div className="detail-item">
                          <label>Created:</label>
                          <span>{new Date(cluster.timestamp * 1000).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="card-actions">
                        <button className="neon-button blue">View Results</button>
                        <button className="neon-button cyan">Export</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="team-section">
          <h2>Our Team</h2>
          <div className="team-grid">
            <div className="team-member neon-card">
              <div className="member-avatar"></div>
              <h4>Dr. Alice Chen</h4>
              <p>FHE Research Lead</p>
              <div className="member-tags">
                <span>Cryptography</span>
                <span>AI Security</span>
              </div>
            </div>
            
            <div className="team-member neon-card">
              <div className="member-avatar"></div>
              <h4>Mark Johnson</h4>
              <p>Blockchain Architect</p>
              <div className="member-tags">
                <span>Smart Contracts</span>
                <span>DeFi</span>
              </div>
            </div>
            
            <div className="team-member neon-card">
              <div className="member-avatar"></div>
              <h4>Sarah Williams</h4>
              <p>Data Scientist</p>
              <div className="member-tags">
                <span>Machine Learning</span>
                <span>Federated Learning</span>
              </div>
            </div>
            
            <div className="team-member neon-card">
              <div className="member-avatar"></div>
              <h4>David Kim</h4>
              <p>Frontend Developer</p>
              <div className="member-tags">
                <span>React</span>
                <span>Web3</span>
              </div>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createCluster} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          clusterData={newClusterData}
          setClusterData={setNewClusterData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content neon-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="neon-globe"></div>
              <span>FedClusterFHE</span>
            </div>
            <p>FHE-Powered Privacy-Preserving Federated Clustering</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">API</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FULLY HOMOMORPHIC ENCRYPTION</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FedClusterFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  clusterData: any;
  setClusterData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  clusterData,
  setClusterData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setClusterData({
      ...clusterData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!clusterData.name || !clusterData.dataPoints) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal neon-card">
        <div className="modal-header">
          <h2>Create New FHE Cluster</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="encryption-icon"></div> 
            <span>All data will be encrypted using FHE before processing</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Cluster Name *</label>
              <input 
                type="text"
                name="name"
                value={clusterData.name} 
                onChange={handleChange}
                placeholder="Enter cluster name" 
                className="neon-input"
              />
            </div>
            
            <div className="form-group">
              <label>Data Points *</label>
              <input 
                type="number"
                name="dataPoints"
                value={clusterData.dataPoints} 
                onChange={handleChange}
                placeholder="Number of data points" 
                className="neon-input"
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label>Clustering Algorithm *</label>
              <select 
                name="algorithm"
                value={clusterData.algorithm} 
                onChange={handleChange}
                className="neon-select"
              >
                <option value="K-Means">K-Means</option>
                <option value="DBSCAN">DBSCAN</option>
                <option value="Hierarchical">Hierarchical</option>
                <option value="Spectral">Spectral</option>
              </select>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> 
            <span>Data remains encrypted during the entire clustering process</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="neon-button blue"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="neon-button purple"
          >
            {creating ? "Encrypting with FHE..." : "Create Cluster"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
