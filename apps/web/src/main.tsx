import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import viVN from 'antd/locale/vi_VN';
import { WorkspaceProvider } from './api';
import { Application } from './App';
// Fonts ship with the app, so a demo without internet still shows the right type.
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/bitter/600.css';
import '@fontsource/bitter/700.css';
import './styles.css';
// The same values as the CSS variables in styles.css.
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={viVN} modal={{closable:{'aria-label':'Đóng'}}} drawer={{closable:{'aria-label':'Đóng'}}} tabs={{more:{icon:<EllipsisOutlined aria-label="Các tab khác"/>}}} theme={{token:{colorPrimary:'#0B7A69',colorSuccess:'#0B7A69',colorInfo:'#2456A6',colorError:'#B4232A',colorLink:'#0B7A69',borderRadius:10,fontSize:14,controlHeight:40,fontFamily:'"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif',colorText:'#0E2A33',colorTextSecondary:'#4A6068',colorTextDescription:'#4A6068',colorTextPlaceholder:'#6B7F86',colorBorder:'#7F9298',colorBorderSecondary:'#D5DEDB',colorBgLayout:'#E9EEEC'},components:{Table:{headerBg:'#F1F5F4',headerColor:'#4A6068',cellPaddingBlock:14},Button:{primaryShadow:'none',defaultShadow:'none',fontWeight:600}}}}><AntApp><WorkspaceProvider><Application/></WorkspaceProvider></AntApp></ConfigProvider></React.StrictMode>);
