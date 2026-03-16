import torch
import torch.nn as nn
import torch.nn.functional as F

class ECGNet(nn.Module):
    def __init__(self, num_classes=4):
        super(ECGNet, self).__init__()
        # 1D Convolutional layers to process the signal
        # Input: (Batch, 12 leads, 1000 samples)
        self.conv1 = nn.Conv1d(12, 32, kernel_size=15, stride=2, padding=7)
        self.bn1 = nn.BatchNorm1d(32)
        self.conv2 = nn.Conv1d(32, 64, kernel_size=15, stride=2, padding=7)
        self.bn2 = nn.BatchNorm1d(64)
        self.conv3 = nn.Conv1d(64, 128, kernel_size=15, stride=2, padding=7)
        self.bn3 = nn.BatchNorm1d(128)
        
        self.pool = nn.AdaptiveAvgPool1d(1) # Flattens the signal to a single value per feature
        
        # Classification layers
        self.fc1 = nn.Linear(128, 64)
        self.dropout = nn.Dropout(0.3)
        self.fc2 = nn.Linear(64, num_classes)

    def forward(self, x):
        x = F.relu(self.bn1(self.conv1(x)))
        x = F.relu(self.bn2(self.conv2(x)))
        x = F.relu(self.bn3(self.conv3(x)))
        
        x = self.pool(x)
        x = x.view(x.size(0), -1) # Flatten for Dense layer
        
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x