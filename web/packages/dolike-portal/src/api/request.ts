import axios, { type AxiosRequestHeaders } from 'axios'
const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true
})

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    // const token = localStorage.getItem('token')
    config.headers = {
      // authorization: token || ''
    } as unknown as AxiosRequestHeaders

    // 保持 axios 默认的 application/json，后端 Fastify 按 JSON 解析

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    if (response.status === 200) {
      const data = response.data || {}
      // 确保列表字段有默认值，防止 undefined 导致的错误
      if (data.aweme_list === undefined) data.aweme_list = []
      if (data.data === undefined && Array.isArray(response.data))
        data.data = response.data
      return data
    }
    return response.data || {}
  },

  async (err) => {
    console.log(err)
    return Promise.reject(err)
  }
)

export default request
