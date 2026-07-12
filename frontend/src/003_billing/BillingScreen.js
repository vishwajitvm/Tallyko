import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert , Platform, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../001_auth_tenant/AuthContext';
import axios from 'axios';
import { PrinterService } from './PrinterService';

const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://127.0.0.1:8000/api/v1';

export default function BillingScreen() {
  const { colors } = useTheme();
  const { token } = useAuth();
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // POS State
  const [isPosOpen, setIsPosOpen] = useState(false);
  const [posStep, setPosStep] = useState('TYPE'); // TYPE, CART, PAYMENT, RECEIPT
  const [orderType, setOrderType] = useState('DINE_IN');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [createdOrder, setCreatedOrder] = useState(null);

  const fetchOrders = async () => {
    try {
      const response = await axios.get(`${API_URL}/billing/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data);
    } catch (error) {
      console.error("Failed to fetch orders", error);
      Alert.alert("Error", "Could not load orders.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await axios.get(`${API_URL}/catalog/products`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProducts(response.data);
    } catch (error) {
      console.error("Failed to fetch products", error);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchProducts();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
    fetchProducts();
  };

  const startNewOrder = () => {
    setOrderType('DINE_IN');
    setCart([]);
    setCreatedOrder(null);
    setPosStep('TYPE');
    setIsPosOpen(true);
  };

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const getCartSubtotal = () => cart.reduce((sum, item) => sum + (item.product.base_price * item.quantity), 0);
  const getGST = () => getCartSubtotal() * 0.05;
  const getCartTotal = () => getCartSubtotal() + getGST();

  const handleCreateOrder = async () => {
    if (cart.length === 0) {
      Alert.alert("Error", "Cart is empty.");
      return;
    }
    
    try {
      const payload = {
        order_type: orderType,
        items: cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          price: item.product.base_price
        }))
      };

      const response = await axios.post(`${API_URL}/billing/orders`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setCreatedOrder(response.data);
      setPosStep('PAYMENT');
      fetchOrders();
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to create order.");
    }
  };

  const handlePayment = async (method) => {
    if (!createdOrder) return;
    
    try {
      await axios.post(`${API_URL}/billing/payments`, {
        order_id: createdOrder.id,
        amount: getCartTotal(),
        method: method
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setPosStep('RECEIPT');
      fetchOrders();
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Payment failed.");
    }
  };

  const handlePrintReceipt = async () => {
    try {
      await PrinterService.connect();
      await PrinterService.printReceipt(createdOrder, cart, getCartSubtotal(), getGST(), getCartTotal());
      Alert.alert("Success", "Receipt printed successfully!");
    } catch (error) {
      Alert.alert("Error", "Failed to print receipt.");
    }
  };

  const renderOrder = ({ item }) => (
    <View style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.secondary + '30' }]}>
      <View style={styles.orderInfo}>
        <Text style={[styles.orderId, { color: colors.text }]}>Order #{item.id.substring(0, 8)}</Text>
        <Text style={[styles.orderType, { color: colors.secondary }]}>Type: {item.type}</Text>
      </View>
      <View style={styles.statusContainer}>
        <Text style={[styles.orderStatus, { color: item.status === 'completed' ? '#34C759' : colors.primary }]}>
          {item.status.toUpperCase()}
        </Text>
        <Text style={[styles.orderTotal, { color: colors.text }]}>${parseFloat(item.total_amount).toFixed(2)}</Text>
      </View>
      <TouchableOpacity 
        style={{ marginLeft: 10, padding: 8, backgroundColor: colors.primary, borderRadius: 8 }}
        onPress={async () => {
          await PrinterService.connect();
          await PrinterService.printReceipt(item, null, item.total_amount / 1.05, (item.total_amount / 1.05) * 0.05, item.total_amount);
          Alert.alert("Success", "Receipt printed successfully!");
        }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Print</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Billing & Orders</Text>
        <TouchableOpacity style={[styles.newOrderBtn, { backgroundColor: colors.primary }]} onPress={startNewOrder}>
          <Text style={styles.newOrderBtnText}>+ New Order</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>No recent orders.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderOrder}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      {/* POS Modal */}
      <Modal visible={isPosOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.secondary + '30' }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New Order</Text>
            <TouchableOpacity onPress={() => setIsPosOpen(false)}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            {posStep === 'TYPE' && (
              <View style={styles.stepContainer}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Select Order Type</Text>
                {['DINE_IN', 'TAKEAWAY', 'DELIVERY'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeBtn, 
                      { 
                        backgroundColor: orderType === type ? colors.primary : colors.surface,
                        borderColor: colors.primary
                      }
                    ]}
                    onPress={() => setOrderType(type)}
                  >
                    <Text style={{ 
                      color: orderType === type ? '#fff' : colors.text, 
                      fontWeight: 'bold', fontSize: 18 
                    }}>{type.replace('_', ' ')}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity 
                  style={[styles.nextBtn, { backgroundColor: colors.primary }]}
                  onPress={() => setPosStep('CART')}
                >
                  <Text style={styles.nextBtnText}>Next</Text>
                </TouchableOpacity>
              </View>
            )}

            {posStep === 'CART' && (
              <View style={styles.cartStepContainer}>
                <View style={styles.productList}>
                  <Text style={[styles.stepTitle, { color: colors.text }]}>Products</Text>
                  <FlatList
                    data={products}
                    keyExtractor={item => item.id}
                    numColumns={2}
                    renderItem={({ item }) => (
                      <TouchableOpacity 
                        style={[styles.productCard, { backgroundColor: colors.surface }]}
                        onPress={() => addToCart(item)}
                      >
                        <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.name}</Text>
                        <Text style={{ color: colors.secondary }}>${item.base_price}</Text>
                      </TouchableOpacity>
                    )}
                  />
                </View>
                <View style={[styles.cartSidebar, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.stepTitle, { color: colors.text }]}>Cart</Text>
                  <ScrollView style={{ flex: 1 }}>
                    {cart.map((item, index) => (
                      <View key={index} style={styles.cartItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.product.name}</Text>
                          <Text style={{ color: colors.secondary }}>{item.quantity} x ${item.product.base_price}</Text>
                        </View>
                        <TouchableOpacity onPress={() => removeFromCart(item.product.id)}>
                          <Text style={{ color: 'red', fontWeight: 'bold' }}>X</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.totalsContainer}>
                    <View style={styles.totalRow}>
                      <Text style={{ color: colors.secondary }}>Subtotal:</Text>
                      <Text style={{ color: colors.text }}>${getCartSubtotal().toFixed(2)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text style={{ color: colors.secondary }}>GST (5%):</Text>
                      <Text style={{ color: colors.text }}>${getGST().toFixed(2)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>Total:</Text>
                      <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 18 }}>${getCartTotal().toFixed(2)}</Text>
                    </View>
                    <TouchableOpacity 
                      style={[styles.nextBtn, { backgroundColor: colors.primary, marginTop: 10 }]}
                      onPress={handleCreateOrder}
                      disabled={cart.length === 0}
                    >
                      <Text style={styles.nextBtnText}>Create Order</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {posStep === 'PAYMENT' && (
              <View style={styles.stepContainer}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Payment</Text>
                <Text style={{ color: colors.text, fontSize: 24, fontWeight: 'bold', marginBottom: 30, textAlign: 'center' }}>
                  Amount Due: ${getCartTotal().toFixed(2)}
                </Text>
                
                {['CASH', 'CARD', 'UPI'].map(method => (
                  <TouchableOpacity
                    key={method}
                    style={[styles.typeBtn, { backgroundColor: colors.surface, borderColor: colors.primary }]}
                    onPress={() => handlePayment(method)}
                  >
                    <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18 }}>Pay by {method}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {posStep === 'RECEIPT' && (
              <View style={styles.stepContainer}>
                <View style={[styles.receiptContainer, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.receiptTitle, { color: colors.text }]}>Tallyko POS</Text>
                  <Text style={{ color: colors.secondary, textAlign: 'center', marginBottom: 20 }}>Receipt</Text>
                  
                  <View style={styles.receiptLine} />
                  <Text style={{ color: colors.text }}>Order #: {createdOrder?.id.substring(0, 8)}</Text>
                  <Text style={{ color: colors.text }}>Type: {createdOrder?.type}</Text>
                  <View style={styles.receiptLine} />
                  
                  {cart.map((item, index) => (
                    <View key={index} style={styles.receiptItem}>
                      <Text style={{ color: colors.text }}>{item.quantity}x {item.product.name}</Text>
                      <Text style={{ color: colors.text }}>${(item.quantity * item.product.base_price).toFixed(2)}</Text>
                    </View>
                  ))}
                  
                  <View style={styles.receiptLine} />
                  <View style={styles.receiptItem}>
                    <Text style={{ color: colors.text }}>Subtotal</Text>
                    <Text style={{ color: colors.text }}>${getCartSubtotal().toFixed(2)}</Text>
                  </View>
                  <View style={styles.receiptItem}>
                    <Text style={{ color: colors.text }}>GST (5%)</Text>
                    <Text style={{ color: colors.text }}>${getGST().toFixed(2)}</Text>
                  </View>
                  <View style={styles.receiptItem}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Total</Text>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>${getCartTotal().toFixed(2)}</Text>
                  </View>
                  <View style={styles.receiptLine} />
                  <Text style={{ color: colors.text, textAlign: 'center', marginTop: 20 }}>Thank you!</Text>
                </View>
                
                <TouchableOpacity 
                  style={[styles.nextBtn, { backgroundColor: colors.primary, marginTop: 20 }]}
                  onPress={handlePrintReceipt}
                >
                  <Text style={styles.nextBtnText}>Print Receipt via Bluetooth</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.nextBtn, { backgroundColor: colors.secondary, marginTop: 10 }]}
                  onPress={() => setIsPosOpen(false)}
                >
                  <Text style={styles.nextBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    padding: 20, paddingTop: 40, paddingBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  title: { fontSize: 24, fontWeight: '800' },
  newOrderBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 },
  newOrderBtnText: { color: '#fff', fontWeight: 'bold' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16 },
  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  orderCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1,
  },
  orderInfo: { flex: 1 },
  orderId: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  orderType: { fontSize: 14 },
  statusContainer: { alignItems: 'flex-end' },
  orderStatus: { fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  orderTotal: { fontSize: 18, fontWeight: '800' },
  
  // Modal Styles
  modalContainer: { flex: 1 },
  modalHeader: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  modalContent: { flex: 1, padding: 20 },
  stepContainer: { flex: 1, justifyContent: 'center', maxWidth: 400, width: '100%', alignSelf: 'center' },
  stepTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  typeBtn: { padding: 20, borderRadius: 12, borderWidth: 1, marginBottom: 15, alignItems: 'center' },
  nextBtn: { padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  nextBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  
  // Cart Styles
  cartStepContainer: { flex: 1, flexDirection: 'row' },
  productList: { flex: 2, paddingRight: 10 },
  productCard: { flex: 1, margin: 5, padding: 15, borderRadius: 8, height: 80, justifyContent: 'center' },
  cartSidebar: { flex: 1, borderRadius: 12, padding: 15, display: 'flex', flexDirection: 'column' },
  cartItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 10 },
  totalsContainer: { marginTop: 'auto', paddingTop: 15, borderTopWidth: 1, borderTopColor: '#ccc' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  
  // Receipt
  receiptContainer: { padding: 30, borderRadius: 16, shadowColor: '#000', shadowOffset: { width:0, height:2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
  receiptTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  receiptLine: { height: 1, backgroundColor: '#ccc', marginVertical: 15 },
  receiptItem: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }
});
