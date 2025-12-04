// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FedClusterFHE is SepoliaConfig {
    struct EncryptedDataPoint {
        uint256 id;
        euint32 encryptedFeatures;
        euint32 encryptedDataOwner;
        euint32 encryptedClusterId;
        uint256 timestamp;
    }
    
    struct DecryptedDataPoint {
        string features;
        string dataOwner;
        string clusterId;
        bool isClustered;
    }

    uint256 public dataPointCount;
    mapping(uint256 => EncryptedDataPoint) public encryptedDataPoints;
    mapping(uint256 => DecryptedDataPoint) public decryptedDataPoints;
    
    mapping(string => euint32) private encryptedClusterStats;
    string[] private clusterList;
    
    mapping(uint256 => uint256) private requestToDataPointId;
    
    event DataPointSubmitted(uint256 indexed id, uint256 timestamp);
    event ClusteringRequested(uint256 indexed id);
    event DataPointClustered(uint256 indexed id);
    
    modifier onlyDataOwner(uint256 dataPointId) {
        _;
    }
    
    function submitEncryptedDataPoint(
        euint32 encryptedFeatures,
        euint32 encryptedDataOwner,
        euint32 encryptedClusterId
    ) public {
        dataPointCount += 1;
        uint256 newId = dataPointCount;
        
        encryptedDataPoints[newId] = EncryptedDataPoint({
            id: newId,
            encryptedFeatures: encryptedFeatures,
            encryptedDataOwner: encryptedDataOwner,
            encryptedClusterId: encryptedClusterId,
            timestamp: block.timestamp
        });
        
        decryptedDataPoints[newId] = DecryptedDataPoint({
            features: "",
            dataOwner: "",
            clusterId: "",
            isClustered: false
        });
        
        emit DataPointSubmitted(newId, block.timestamp);
    }
    
    function requestFederatedClustering(uint256 dataPointId) public onlyDataOwner(dataPointId) {
        EncryptedDataPoint storage dp = encryptedDataPoints[dataPointId];
        require(!decryptedDataPoints[dataPointId].isClustered, "Already clustered");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(dp.encryptedFeatures);
        ciphertexts[1] = FHE.toBytes32(dp.encryptedDataOwner);
        ciphertexts[2] = FHE.toBytes32(dp.encryptedClusterId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.performClustering.selector);
        requestToDataPointId[reqId] = dataPointId;
        
        emit ClusteringRequested(dataPointId);
    }
    
    function performClustering(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataPointId = requestToDataPointId[requestId];
        require(dataPointId != 0, "Invalid request");
        
        EncryptedDataPoint storage eDp = encryptedDataPoints[dataPointId];
        DecryptedDataPoint storage dDp = decryptedDataPoints[dataPointId];
        require(!dDp.isClustered, "Already clustered");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory features, string memory dataOwner, string memory clusterId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dDp.features = features;
        dDp.dataOwner = dataOwner;
        dDp.clusterId = clusterId;
        dDp.isClustered = true;
        
        if (FHE.isInitialized(encryptedClusterStats[dDp.clusterId]) == false) {
            encryptedClusterStats[dDp.clusterId] = FHE.asEuint32(0);
            clusterList.push(dDp.clusterId);
        }
        encryptedClusterStats[dDp.clusterId] = FHE.add(
            encryptedClusterStats[dDp.clusterId], 
            FHE.asEuint32(1)
        );
        
        emit DataPointClustered(dataPointId);
    }
    
    function getDecryptedDataPoint(uint256 dataPointId) public view returns (
        string memory features,
        string memory dataOwner,
        string memory clusterId,
        bool isClustered
    ) {
        DecryptedDataPoint storage dp = decryptedDataPoints[dataPointId];
        return (dp.features, dp.dataOwner, dp.clusterId, dp.isClustered);
    }
    
    function getEncryptedClusterStats(string memory clusterId) public view returns (euint32) {
        return encryptedClusterStats[clusterId];
    }
    
    function requestClusterStatsDecryption(string memory clusterId) public {
        euint32 stats = encryptedClusterStats[clusterId];
        require(FHE.isInitialized(stats), "Cluster not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptClusterStats.selector);
        requestToDataPointId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(clusterId)));
    }
    
    function decryptClusterStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 clusterHash = requestToDataPointId[requestId];
        string memory clusterId = getClusterFromHash(clusterHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getClusterFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < clusterList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(clusterList[i]))) == hash) {
                return clusterList[i];
            }
        }
        revert("Cluster not found");
    }
    
    function calculateClusterCentroids(
        string memory clusterId
    ) public view returns (string memory centroidFeatures) {
        uint256 count = 0;
        string[] memory allFeatures;
        
        for (uint256 i = 1; i <= dataPointCount; i++) {
            if (decryptedDataPoints[i].isClustered && 
                keccak256(abi.encodePacked(decryptedDataPoints[i].clusterId)) == keccak256(abi.encodePacked(clusterId))) {
                allFeatures[count] = decryptedDataPoints[i].features;
                count++;
            }
        }
        
        // Simplified centroid calculation
        // In real implementation, this would perform actual clustering algorithm
        return count > 0 ? allFeatures[0] : "";
    }
    
    function findSimilarClusters(
        string memory targetFeatures,
        uint256 similarityThreshold
    ) public view returns (string[] memory similarClusters) {
        uint256 count = 0;
        
        for (uint256 i = 0; i < clusterList.length; i++) {
            string memory centroid = calculateClusterCentroids(clusterList[i]);
            if (calculateSimilarity(targetFeatures, centroid) >= similarityThreshold) {
                count++;
            }
        }
        
        similarClusters = new string[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < clusterList.length; i++) {
            string memory centroid = calculateClusterCentroids(clusterList[i]);
            if (calculateSimilarity(targetFeatures, centroid) >= similarityThreshold) {
                similarClusters[index] = clusterList[i];
                index++;
            }
        }
        return similarClusters;
    }
    
    function calculateSimilarity(
        string memory features1,
        string memory features2
    ) private pure returns (uint256) {
        // Simplified similarity calculation
        // In real implementation, this would use proper distance metrics
        return keccak256(abi.encodePacked(features1)) == keccak256(abi.encodePacked(features2)) ? 100 : 50;
